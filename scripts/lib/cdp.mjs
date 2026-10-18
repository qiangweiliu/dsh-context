/**
 * Shared Edge/CDP bootstrap for the one-off UI probes.
 * Connection only: callers still decide when to enable Runtime/Page and navigate.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function openCdp({ port, profilePrefix = 'edge-dsh-', captureConsole = false, captureAllConsole = false, timeoutMs = 12000 } = {}) {
  if (!Number.isInteger(port) || port <= 0) throw new Error('openCdp requires a valid port')
  const profile = mkdtempSync(join(tmpdir(), profilePrefix))
  const child = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
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
