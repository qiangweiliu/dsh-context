/**
 * 提示词编辑 UI 点击探针：编辑 → 保存 → 确认 → 下一次请求生效 → 恢复原文。
 * 用法：node scripts/ui-check-prompt-editor.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9344
const profile = mkdtempSync(join(tmpdir(), 'edge-pedit-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TARGET = 'harness:identity'
const EDITED = 'You are a TEST agent edited by the ctx UI probe.'

let page
for (let i = 0; i < 60 && !page; i += 1) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  } catch {}
  if (!page) await sleep(200)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.id !== undefined) {
    const e = pending.get(m.id)
    if (e) {
      pending.delete(m.id)
      m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result)
    }
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    errors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(350)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
  })()`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
}
await sleep(2500)

// 1) 新会话 + 两条消息
await evaluate(`(async () => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || ''))
  if (b) b.click()
  await new Promise((r) => setTimeout(r, 1000))
})()`)
await sendMessage('hi')
await sleep(11000)
await sendMessage('second message so the prompt listener is installed')
await sleep(11000)

// 2) 打开面板 → 展开提示词 → 展开目标 → 编辑 → 保存 → 确认
const openEditor = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const sidebar = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!sidebar) return { ok: false, why: 'sidebar ctx not found' }
  sidebar.click()
  await new Promise((r) => setTimeout(r, 2500))
  const prompts = document.querySelector('[data-ctx-section="prompts"]')
  if (!prompts) return { ok: false, why: 'prompts section not found' }
  prompts.click()
  await new Promise((r) => setTimeout(r, 500))
  const key = 'prompt:${TARGET}'
  const row = document.querySelector('[data-ctx-expand="' + key + '"]')
  if (!row) return { ok: false, why: 'target section row not found' }
  row.click()
  await new Promise((r) => setTimeout(r, 500))
  const edit = document.querySelector('[data-ctx-prompt-edit="${TARGET}"]')
  if (!edit) return { ok: false, why: 'edit button not found' }
  const before = (document.querySelector('[data-ctx-detail="' + key + '"]') || {}).textContent || ''
  edit.click()
  await new Promise((r) => setTimeout(r, 400))
  const area = document.querySelector('[data-ctx-prompt-editor="${TARGET}"]')
  if (!area) return { ok: false, why: 'editor textarea not found' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(area, ${JSON.stringify(EDITED)})
  area.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  const save = document.querySelector('[data-ctx-prompt-save="${TARGET}"]')
  if (!save) return { ok: false, why: 'save button not found' }
  save.click()
  await new Promise((r) => setTimeout(r, 400))
  const confirm = document.querySelector('[data-ctx-prompt-confirm="${TARGET}"]')
  if (!confirm) return { ok: false, why: 'confirm button not found' }
  confirm.click()
  await new Promise((r) => setTimeout(r, 1800))
  const after = (document.querySelector('[data-ctx-detail="' + key + '"]') || {}).textContent || ''
  const overrides = await fetch('/api/ctx-mon-and-con/status/inventory', { headers: { accept: 'application/json' } })
    .then((r) => r.json())
    .then((j) => j.promptOverrides)
    .catch(() => null)
  return { ok: true, before: before.slice(0, 60), afterLocal: after.slice(0, 80), overrides }
})()`)

// 3) 重新加载并再发一条消息，让装配应用覆盖
await send('Page.reload')
await sleep(7000)
await sendMessage('apply the prompt override')
await sleep(12000)

// 4) 再次打开面板，确认 inventory 里的生效文本
const applied = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const sidebar = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!sidebar) return { ok: false, why: 'sidebar ctx not found' }
  sidebar.click()
  await new Promise((r) => setTimeout(r, 2500))
  const prompts = document.querySelector('[data-ctx-section="prompts"]')
  if (prompts) { prompts.click(); await new Promise((r) => setTimeout(r, 500)) }
  const key = 'prompt:${TARGET}'
  const row = document.querySelector('[data-ctx-expand="' + key + '"]')
  if (!row) return { ok: false, why: 'target row missing after reload' }
  row.click()
  await new Promise((r) => setTimeout(r, 500))
  const text = (document.querySelector('[data-ctx-detail="' + key + '"]') || {}).textContent || ''
  const overridden = Boolean(document.querySelector('[data-ctx-prompt-reset="${TARGET}"]'))
  return { ok: true, text: text.slice(0, 90), overridden }
})()`)

// 5) 点「恢复原文」并确认覆盖被清空
const restored = await evaluate(`(async () => {
  const reset = document.querySelector('[data-ctx-prompt-reset="${TARGET}"]')
  if (!reset) return { ok: false, why: 'reset button not found' }
  reset.click()
  await new Promise((r) => setTimeout(r, 2500))
  for (let i = 0; i < 12; i += 1) {
    const state = await fetch('/api/ctx-mon-and-con/status/inventory', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .catch(() => null)
    if (state && state.promptOverrides && Object.keys(state.promptOverrides).length === 0) return { ok: true, overrides: state.promptOverrides }
    await new Promise((r) => setTimeout(r, 800))
  }
  const last = await fetch('/api/ctx-mon-and-con/status/inventory', { headers: { accept: 'application/json' } }).then((r) => r.json()).catch(() => null)
  return { ok: false, overrides: last && last.promptOverrides }
})()`)

console.log(JSON.stringify({ openEditor, applied, restored, errors }, null, 2))
try {
  await send('Browser.close')
} catch {}
ws.close()
child.kill()
await sleep(300)
try {
  rmSync(profile, { recursive: true, force: true })
} catch {}
process.exit(0)
