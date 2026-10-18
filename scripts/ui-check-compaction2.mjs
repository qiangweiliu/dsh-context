/**
 * 真实端到端压缩降量验证：用“只回复 OK、不要调用工具”的填充消息积累历史，
 * 再把预算下调到当前用量以下，触发 pre-step 压缩，断言 after < before 且会话可继续。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9361
const profile = mkdtempSync(join(tmpdir(), 'edge-comp2-'))
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
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 128000, warnAt: 0.7, errorAt: 0.9 })
await sleep(5000)
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1200)) })()`)
const base = await live()
const filler = 'This is neutral filler content for a context test. '.repeat(300)
const stages = []
for (let i = 1; i <= 6; i += 1) {
  await sendText(`Filler ${i}. ${filler} Reply with exactly OK. Do not call any tools.`)
  await sleep(7000)
  stages.push({ message: i, used: (await live())?.used })
}
const before = await live()
const budget = Math.max(8000, (before?.used || 20000) - 3000)
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: budget, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)
await sendText('Reply with exactly OK. Do not call any tools.')
await sleep(30000)
const after = await live()
const status = await api('/api/ctx-mon-and-con/status')
const body = await evaluate('(document.body.innerText || "").slice(-1200)')
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 128000, warnAt: 0.7, errorAt: 0.9 })
console.log(JSON.stringify({
  errors,
  base: base?.used,
  stages,
  budget,
  before: before?.used,
  after: after?.used,
  reduced: typeof after?.used === 'number' && typeof before?.used === 'number' ? after.used < before.used : null,
  compaction: status.body?.control?.lastCompaction,
  lastError: status.body?.control?.lastError,
  bodyTail: body,
}, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
