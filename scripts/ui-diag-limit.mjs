/**
 * 诊断：低预算下 idle 自动压缩是否触发、dock 环形颜色。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9356
const profile = mkdtempSync(join(tmpdir(), 'edge-diag-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 60 && !page; i += 1) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}; if (!page) await sleep(200) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => { const m = JSON.parse(event.data); if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } } })
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: 3000, warnAt: 0.7, errorAt: 0.9 })
await sleep(6000)
await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
await send('Input.insertText', { text: 'hi from diag' })
await sleep(400)
await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
const timeline = []
const started = Date.now()
let compactAt = null
for (let i = 0; i < 40; i += 1) {
  await sleep(3000)
  const s = await api('/api/ctx-mon-and-con/status')
  const control = s.body && s.body.control
  const live = await api('/api/ctx-mon-and-con/status/live')
  timeline.push({ t: Math.round((Date.now() - started) / 1000), active: control && control.active, mode: control && control.mode, last: control && control.lastCompactionAt, liveRatio: live.body && live.body.ratio })
  if (control && control.lastCompactionAt && !compactAt) { compactAt = control.lastCompactionAt; break }
}
const ring = await evaluate(`(() => { const circles = document.querySelectorAll('[data-ctx-dock] svg circle'); if (!circles.length) return null; const last = circles[circles.length - 1]; return { stroke: getComputedStyle(last).stroke, dockText: document.querySelector('[data-ctx-dock]').textContent.trim() } })()`)
console.log(JSON.stringify({ compactAt, timeline, ring }, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
