/**
 * 验证：输入框下方 ctx 指示器 + 侧栏 ctx 页 + 一键启用自动压缩（写 agent preset）。
 *
 * 用法：node scripts/ui-probe-ctx2.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
if (!baseUrl) { console.error('usage: node ui-probe-ctx2.mjs <url>'); process.exit(2) }
const token = new URL(baseUrl).searchParams.get('token') || ''
const statusUrl = new URL('/api/ctx-mon-and-con/status', baseUrl)
if (token) statusUrl.searchParams.set('token', token)

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9335
const profile = mkdtempSync(join(tmpdir(), 'edge-ctx2-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('no page target')
}
const page = await pageTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result) }
    return
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(String(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text).slice(0, 400))
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) consoleErrors.push(`[${message.params.type}] ` + message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''))
  return result.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)

// 1) 执行 /ctx，制造一个有 session 的 composer（dock 才会渲染）
const focusComposer = await evaluate(`(async () => {
  const composer = document.querySelector('textarea, [contenteditable="true"]')
  if (!composer) return false
  composer.focus()
  return document.activeElement === composer
})()`)
let runCtx = { ok: false, why: 'composer not focused' }
if (focusComposer) {
  await send('Input.insertText', { text: '/ctx' })
  await sleep(900)
  const picked = await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, [role="button"]'))
    const hit = items.find((el) => { const t = norm(el.textContent); return t && t.length < 80 && t.includes('ctx') && !el.closest('[contenteditable="true"], textarea') })
    if (!hit) return null
    hit.click()
    return norm(hit.textContent).slice(0, 60)
  })()`)
  await sleep(800)
  const sent = await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const send = Array.from(document.querySelectorAll('button')).find((b) => /发送消息|send message/i.test(norm(b.getAttribute('aria-label')) || ''))
    if (!send) return false
    send.click()
    return true
  })()`)
  await sleep(5000)
  runCtx = { ok: Boolean(picked && sent), picked, sent, body: await evaluate(`(document.body.innerText || '').slice(0, 2500)`) }
}

const statusBefore = await (await fetch(statusUrl)).json().catch(() => null)
const dockVisible = /ctx 预算/.test(runCtx.body || '')

// 2) 打开侧栏 ctx 页
const openPanel = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const hit = Array.from(document.querySelectorAll('button')).find((b) => /(^|[|\\s])ctx([|\\s]|$)/i.test([b.getAttribute('aria-label'), norm(b.textContent)].filter(Boolean).join('|')) || /ctx/i.test(b.getAttribute('aria-label') || ''))
  if (!hit) return { ok: false }
  hit.click()
  await new Promise((r) => setTimeout(r, 1200))
  return { ok: true, body: (document.body.innerText || '').slice(0, 2500) }
})()`)

// 3) 点「启用自动压缩」
const enable = openPanel.ok ? await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const buttons = Array.from(document.querySelectorAll('button'))
  const enableBtn = buttons.find((b) => /启用自动压缩/.test(norm(b.textContent)))
  if (!enableBtn) {
    const disableBtn = buttons.find((b) => /停用自动压缩/.test(norm(b.textContent)))
    return { ok: true, alreadyEnabled: Boolean(disableBtn), body: (document.body.innerText || '').slice(0, 1500) }
  }
  enableBtn.click()
  await new Promise((r) => setTimeout(r, 6000))
  return { ok: true, body: (document.body.innerText || '').slice(0, 2500) }
})()`) : { ok: false, why: 'panel not opened' }

const statusAfter = await (await fetch(statusUrl)).json().catch(() => null)

console.log(JSON.stringify({
  runCtx: { ok: runCtx.ok, why: runCtx.why, dockVisible, body: runCtx.body },
  statusBeforeControl: statusBefore && statusBefore.control,
  openPanel: { ok: openPanel.ok, hasEnableButton: /启用自动压缩/.test(openPanel.body || ''), body: openPanel.body },
  enable,
  statusAfterControl: statusAfter && statusAfter.control,
  statusAfterBudget: statusAfter && statusAfter.budget,
  consoleErrors,
}, null, 2))

try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(500)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
