/**
 * 会话级开关持久化：setup 设置开关，重启后 verify 恢复并按 sessionId 读取。
 * 用法：node scripts/ui-check-session-persist.mjs <url> <setup|verify>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const phase = process.argv[3]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = phase === 'setup' ? 9347 : 9348
const profile = mkdtempSync(join(tmpdir(), `edge-sess-${phase}-`))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 60 && !page; i += 1) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}
  if (!page) await sleep(200)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 200))
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(350)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return r.json().catch(() => null)
})()`)

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2000)

let out = { phase, errors }
if (phase === 'setup') {
  await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
  await sendMessage('hi')
  await sleep(10000)
  await sendMessage('second message so inventory is recorded')
  await sleep(10000)
  const pre = await api('/api/ctx-mon-and-con/status/inventory')
  const targetId = pre && pre.sessionId
  await api('/api/ctx-mon-and-con/status/inventory/toggle', { kind: 'tool', name: 'bash', layer: 'session', enabled: false, sessionId: targetId })
  await api('/api/ctx-mon-and-con/status/inventory/toggle', { kind: 'prompt', name: 'harness:identity', layer: 'session', enabled: false, sessionId: targetId })
  await sleep(1500)
  const state = await api('/api/ctx-mon-and-con/status/inventory?sessionId=' + encodeURIComponent(targetId))
  out = { ...out, sessionId: state && state.sessionId, disabledSessionTools: state && state.disabledSessionTools, disabledSessionPrompts: state && state.disabledSessionPrompts }
} else {
  const oldId = process.env.SESS_OLD_ID
  const restored = oldId ? await api(`/api/ctx-mon-and-con/status/inventory?sessionId=${encodeURIComponent(oldId)}`) : null
  out = {
    ...out,
    sessionId: oldId,
    restored: restored
      ? { disabledSessionTools: restored.disabledSessionTools, disabledSessionPrompts: restored.disabledSessionPrompts }
      : null,
  }
  // 清理该会话开关
  if (oldId) {
    await api('/api/ctx-mon-and-con/status/inventory/reset', { layer: 'session', sessionId: oldId })
    await sleep(1200)
    const cleaned = await api(`/api/ctx-mon-and-con/status/inventory?sessionId=${encodeURIComponent(oldId)}`)
    out.cleaned = cleaned ? { disabledSessionTools: cleaned.disabledSessionTools, disabledSessionPrompts: cleaned.disabledSessionPrompts } : null
  }
}

console.log(JSON.stringify(out, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
