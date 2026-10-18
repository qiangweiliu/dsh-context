/**
 * 提示词编辑 UI 点击探针：编辑 → 保存 → 确认 → 下一次请求生效 → 恢复原文。
 * 用法：node scripts/ui-check-prompt-editor.mjs <url>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9344
const TARGET = 'harness:identity'
const EDITED = 'You are a TEST agent edited by the ctx UI probe.'

const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-pedit-', captureConsole: true })
const sendMessage = (text) => sendText({ send, evaluate }, text)


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
await close()
process.exit(0)
