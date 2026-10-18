/**
 * 验证上下文压缩：预算 20000，灌多轮长消息超过预算，下一请求 pre-step 应触发压缩并降低用量，且任务不中断。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9360
const profile = mkdtempSync(join(tmpdir(), 'edge-compact-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 60 && !page; i += 1) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}; if (!page) await sleep(200) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => { const m = JSON.parse(event.data); if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } return } if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 200)) })
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
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
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
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
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
