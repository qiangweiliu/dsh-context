/**
 * 验证 ctx 面板控制卡里显示 lastError（预算低于基础开销时）。
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9359
const { send, evaluate, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-lasterr-' })
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
const sendText = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(400)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
await api('/api/agent-embodiment/status/config', { contextWindowTokens: 3000, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)
await sendText('first message')
await sleep(10000)
await sendText('second message triggers pre-step check')
await sleep(15000)
const status = await api('/api/agent-embodiment/status')
const panel = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 2500))
  const el = document.querySelector('[data-embodiment-lasterror]')
  return { ok: true, lastErrorText: el ? el.textContent.trim() : null, body: (document.body.innerText || '').slice(0, 1200) }
})()`)
await api('/api/agent-embodiment/status/config', { contextWindowTokens: 128000, warnAt: 0.7, errorAt: 0.9 })
console.log(JSON.stringify({ controlLastError: status.body?.control?.lastError, panel }, null, 2))
await close()
process.exit(0)
