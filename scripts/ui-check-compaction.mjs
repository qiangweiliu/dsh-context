/**
 * 验证上下文压缩：预算 20000，灌多轮长消息超过预算，下一请求 pre-step 应触发压缩并降低用量，且任务不中断。
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9360
const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-compact-' })
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
const sendText = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(500)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}
const live = async () => (await api('/api/ctx-mon-and-con/status/live')).body
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 20000, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)

const filler = 'Please remember this context detail for later. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(220)
const stages = []
for (let i = 1; i <= 4; i += 1) {
  await sendText(`Message ${i}: ${filler}`)
  await sleep(12000)
  const l = await live()
  stages.push({ message: i, used: l?.used, ratio: l?.ratio })
}
const before = await live()
// 把预算下调到已用量以下，让下一条消息的 pre-step 触发压缩
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 15000, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)
const s0 = await api('/api/ctx-mon-and-con/status')
await sendText('Final message: please answer briefly and confirm you still have context.')
await sleep(25000)
const after = await live()
const s1 = await api('/api/ctx-mon-and-con/status')
const body = await evaluate('(document.body.innerText || "").slice(-1600)')
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 128000, warnAt: 0.7, errorAt: 0.9 })
console.log(JSON.stringify({
  errors,
  stages,
  before: { used: before?.used, ratio: before?.ratio, last: s0.body?.control?.lastCompactionAt },
  after: { used: after?.used, ratio: after?.ratio },
  compaction: s1.body?.control?.lastCompaction,
  lastError: s1.body?.control?.lastError,
  bodyTail: body,
}, null, 2))
await close()
process.exit(0)
