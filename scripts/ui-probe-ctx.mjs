/**
 * 验证侧边栏「ctx」整页 + 面板内编辑全局配置（Windows Edge headless + CDP）。
 *
 * 步骤：打开页面 → 点左侧 ctx → 读页面文本 → 改预算并保存 → 从 Node 直接请求
 * 插件状态接口确认真值变了 → 再改回默认值。
 *
 * 用法：node scripts/ui-probe-ctx.mjs <url> [新预算]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const newBudget = process.argv[3] || '90000'
if (!baseUrl) {
  console.error('usage: node ui-probe-ctx.mjs <url> [budget]')
  process.exit(2)
}
const token = new URL(baseUrl).searchParams.get('token') || ''
const statusUrl = new URL('/api/ctx-mon-and-con/status', baseUrl)
if (token) statusUrl.searchParams.set('token', token)

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9334
const profile = mkdtempSync(join(tmpdir(), 'edge-ctx-'))
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('Edge did not expose a page target')
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let id = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const entry = pending.get(message.id)
    if (entry) {
      pending.delete(message.id)
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text).slice(0, 400))
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    consoleErrors.push(`[${message.params.type}] ` + message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  pending.set(requestId, { resolve, reject })
  ws.send(JSON.stringify({ id: requestId, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''))
  return result.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: baseUrl })
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(500)
  if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
}
await sleep(2500)

const clickCtx = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const buttons = Array.from(document.querySelectorAll('button'))
  const hit = buttons.find((b) => {
    const s = [b.getAttribute('aria-label'), b.getAttribute('title'), norm(b.textContent)].filter(Boolean).join('|')
    return /(^|[|\\s])ctx([|\\s]|$)/i.test(s) || /ctx/i.test(b.getAttribute('aria-label') || '')
  })
  if (!hit) return { clicked: false, buttons: buttons.slice(0, 12).map((b) => [b.getAttribute('aria-label'), norm(b.textContent)]) }
  hit.click()
  await new Promise((r) => setTimeout(r, 1200))
  return { clicked: true, label: [hit.getAttribute('aria-label'), norm(hit.textContent)].join('|'), body: (document.body.innerText || '').slice(0, 2500) }
})()`)

const statusBefore = await (await fetch(statusUrl)).json().catch(() => null)

const edit = await evaluate(`(async () => {
  const setNative = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const input = document.querySelector('input[type="number"]')
  if (!input) return { ok: false, why: 'number input not found', body: (document.body.innerText || '').slice(0, 1500) }
  setNative(input, ${JSON.stringify(newBudget)})
  await new Promise((r) => setTimeout(r, 300))
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const save = Array.from(document.querySelectorAll('button')).find((b) => /保存|save/i.test(norm(b.textContent)))
  if (!save) return { ok: false, why: 'save button not found' }
  save.click()
  await new Promise((r) => setTimeout(r, 3500))
  return { ok: true, body: (document.body.innerText || '').slice(0, 2500) }
})()`)

const statusAfter = await (await fetch(statusUrl)).json().catch(() => null)

// 改回默认值，避免留下测试配置
const restore = await evaluate(`(async () => {
  const setNative = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const input = document.querySelector('input[type="number"]')
  if (!input) return { ok: false }
  setNative(input, '128000')
  await new Promise((r) => setTimeout(r, 300))
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const save = Array.from(document.querySelectorAll('button')).find((b) => /保存|save/i.test(norm(b.textContent)))
  if (!save) return { ok: false }
  save.click()
  await new Promise((r) => setTimeout(r, 2500))
  return { ok: true }
})()`)
const statusRestored = await (await fetch(statusUrl)).json().catch(() => null)

console.log(JSON.stringify({
  clickCtx: { clicked: clickCtx.clicked, label: clickCtx.label, bodyHasTitle: /ctx/.test(clickCtx.body || ''), body: clickCtx.body },
  statusBefore: statusBefore && statusBefore.budget,
  edit: { ok: edit.ok, why: edit.why, savedVisible: /已保存|Saved/.test(edit.body || ''), body: edit.body },
  statusAfter: statusAfter && statusAfter.budget,
  restore,
  statusRestored: statusRestored && statusRestored.budget,
  consoleErrors,
}, null, 2))

try { await send('Browser.close') } catch {}
ws.close()
child.kill()
await sleep(500)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
