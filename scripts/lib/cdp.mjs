/**
 * Shared Edge/CDP bootstrap for the one-off UI probes.
 * Connection only: callers still decide when to enable Runtime/Page and navigate.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * WSL interop 只能直接执行 /mnt/<drive>/... 形式的 Windows exe；同时
 * Windows 版 Edge 不认识 Linux 路径的 --user-data-dir。这里按需做双向路径转换。
 */
function wslPathToWindows(path) {
  try {
    return execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim()
  } catch {
    return path
  }
}

function windowsPathToWsl(path) {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(path)
  if (!match) return path
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/gu, '/')}`
}

const WINDOWS_EXE = /^[A-Za-z]:[\\/]/u.test(EDGE) || /\.exe$/iu.test(EDGE)
const EXECUTABLE = WINDOWS_EXE ? windowsPathToWsl(EDGE) : EDGE

export async function openCdp({ port, profilePrefix = 'edge-dsh-', captureConsole = false, captureAllConsole = false, timeoutMs = 12000 } = {}) {
  if (!Number.isInteger(port) || port <= 0) throw new Error('openCdp requires a valid port')
  const profile = mkdtempSync(join(tmpdir(), profilePrefix))
  const profileArg = WINDOWS_EXE ? wslPathToWindows(profile) : profile
  const child = spawn(EXECUTABLE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileArg}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let page
  for (let waited = 0; waited < timeoutMs && !page; waited += 200) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    } catch {}
    if (!page) await sleep(200)
  }
  if (!page) {
    child.kill()
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
    throw new Error('Edge remote debugging did not come up')
  }

  let ws
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
  } catch (error) {
    child.kill()
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
    throw error
  }

  let seq = 0
  const pending = new Map()
  const errors = []
  const consoleLines = []
  const exceptions = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
      if (captureAllConsole) consoleLines.push(`[${message.params.type}] ${text}`)
      if (captureConsole && ['error', 'warning'].includes(message.params.type)) errors.push(`[${message.params.type}] ${text}`)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails
      const text = String(detail?.exception?.description || detail?.text || '')
      exceptions.push(text.slice(0, 600))
      errors.push(text.slice(0, 300))
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const close = async () => {
    try { await send('Browser.close') } catch {}
    ws.close()
    child.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }

  return { page, ws, child, profile, send, evaluate, errors, consoleLines, exceptions, close }
}

/** Open a page and wait until the app shell has rendered. */
export async function openPage(url, options = {}) {
  const { waitMs = 2500, ...cdpOptions } = options
  const client = await openCdp(cdpOptions)
  const { send, evaluate } = client
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url })
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
  }
  await sleep(waitMs)
  return client
}

/** Focus the composer, type text, and click the send button. */
export async function sendMessage({ send, evaluate }, text, waitMs = 350) {
  await evaluate(`(() => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(waitMs)
  await evaluate(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
  })()`)
}

/** Click the first button whose label or visible text matches. */
export async function clickButton(evaluate, pattern) {
  return evaluate(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)})
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => re.test(norm(el.getAttribute('aria-label')) || '') || re.test(norm(el.textContent)))
    if (!b) return false
    b.click()
    return true
  })()`)
}
