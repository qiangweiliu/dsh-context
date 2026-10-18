/**
 * 验证：pre-step 触发压缩（compactIfNeeded pressure 优先 + compactRegion 保留最近 tokens），
 * 不打断当前任务、第二条消息仍正常回复。
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9358
const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-preserve-' })
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
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 3000, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)
await sendText('first task message before compaction')
await sleep(12000)
await sendText('second task message should still be answered')
await sleep(18000)
const status = await api('/api/ctx-mon-and-con/status')
const live = await api('/api/ctx-mon-and-con/status/live')
const body = await evaluate('(document.body.innerText || "").slice(0, 2500)')
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 128000, warnAt: 0.7, errorAt: 0.9 })
console.log(JSON.stringify({
  errors,
  control: status.body && status.body.control,
  live: live.body && { used: live.body.used, budget: live.body.budget, ratio: live.body.ratio },
  bothReplies: body.includes('first task message before compaction') && body.includes('second task message should still be answered'),
  bodyTail: body.slice(-700),
}, null, 2))
await close()
process.exit(0)
