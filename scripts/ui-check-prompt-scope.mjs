/**
 * 提示词「仅本会话 / 保存到全局」：setup 用 UI 点「仅保存到本会话」；verify 跨重启 + 全局保存 + 清理。
 * 用法：node scripts/ui-check-prompt-scope.mjs <url> <setup|verify>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const phase = process.argv[3]
const port = phase === 'setup' ? 9349 : 9350
const { send, evaluate, errors, close } = await openPage(baseUrl, { waitMs: 2000, port, profilePrefix: `edge-scope-${phase}-` })
const TARGET = 'harness:identity'
const SESSION_TEXT = 'SESSION-ONLY-PROMPT'
const GLOBAL_TEXT = 'GLOBAL-PROMPT'
const sendMessage = (text) => sendText({ send, evaluate }, text)
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return r.json().catch(() => null)
})()`)


let out = { phase, errors }
if (phase === 'setup') {
  await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
  await sendMessage('hi')
  await sleep(10000)
  await sendMessage('second message so inventory is recorded')
  await sleep(10000)
  const sessionId = (await api('/api/ctx-mon-and-con/status/inventory')).sessionId
  const ui = await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const sidebar = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
    if (!sidebar) return { ok: false, why: 'sidebar ctx not found' }
    sidebar.click()
    await new Promise((r) => setTimeout(r, 2500))
    document.querySelector('[data-ctx-section="prompts"]').click()
    await new Promise((r) => setTimeout(r, 500))
    const key = 'prompt:${TARGET}'
    document.querySelector('[data-ctx-expand="' + key + '"]').click()
    await new Promise((r) => setTimeout(r, 500))
    document.querySelector('[data-ctx-prompt-edit="${TARGET}"]').click()
    await new Promise((r) => setTimeout(r, 400))
    const area = document.querySelector('[data-ctx-prompt-editor="${TARGET}"]')
    if (!area) return { ok: false, why: 'textarea missing' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, ${JSON.stringify(SESSION_TEXT)})
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const saveSession = document.querySelector('[data-ctx-prompt-save-session="${TARGET}"]')
    if (!saveSession) return { ok: false, why: 'session save button missing' }
    saveSession.click()
    await new Promise((r) => setTimeout(r, 1800))
    return { ok: true }
  })()`)
  const state = await api('/api/ctx-mon-and-con/status/inventory?sessionId=' + encodeURIComponent(sessionId))
  const section = state && state.inventory ? state.inventory.sections.find((s) => s.name === TARGET) : null
  out = { ...out, sessionId, ui, promptOverrides: state && state.promptOverrides, section: section ? { text: section.text, sessionOverridden: section.sessionOverridden, globalOverridden: section.globalOverridden } : null }
} else {
  const oldId = process.env.SCOPE_OLD_ID
  const saved = await api('/api/ctx-mon-and-con/status/inventory?sessionId=' + encodeURIComponent(oldId))
  const before = saved && saved.inventory ? saved.inventory.sections.find((s) => s.name === TARGET) : null
  const globalSave = await api('/api/ctx-mon-and-con/status/inventory/prompt', { name: TARGET, text: GLOBAL_TEXT })
  await sleep(4000)
  const afterGlobal = await api('/api/ctx-mon-and-con/status/inventory?sessionId=' + encodeURIComponent(oldId))
  const afterSection = afterGlobal && afterGlobal.inventory ? afterGlobal.inventory.sections.find((s) => s.name === TARGET) : null
  // 清理：清会话覆盖 + 清全局覆盖
  await api('/api/ctx-mon-and-con/status/inventory/prompt/session/reset', { name: TARGET, sessionId: oldId })
  await api('/api/ctx-mon-and-con/status/inventory/prompt/reset', { name: TARGET })
  await sleep(4000)
  const cleaned = await api('/api/ctx-mon-and-con/status/inventory?sessionId=' + encodeURIComponent(oldId))
  const cleanedSection = cleaned && cleaned.inventory ? cleaned.inventory.sections.find((s) => s.name === TARGET) : null
  out = {
    ...out,
    sessionId: oldId,
    before: before ? { text: before.text, sessionOverridden: before.sessionOverridden, globalOverridden: before.globalOverridden } : null,
    globalSave,
    after: afterSection ? { text: afterSection.text, sessionOverridden: afterSection.sessionOverridden, globalOverridden: afterSection.globalOverridden } : null,
    promptOverrides: afterGlobal && afterGlobal.promptOverrides,
    cleaned: cleaned ? { promptOverrides: cleaned.promptOverrides, section: cleanedSection ? { text: cleanedSection.text, sessionOverridden: cleanedSection.sessionOverridden, globalOverridden: cleanedSection.globalOverridden } : null } : null,
  }
}

console.log(JSON.stringify(out, null, 2))
await close()
process.exit(0)
