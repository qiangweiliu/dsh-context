import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9343
const profile = mkdtempSync(join(tmpdir(), 'edge-rall-'))
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
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2000)
const result = await evaluate(`(async () => {
  const base = '/api/ctx-mon-and-con/status'
  const inv = () => fetch(base + '/inventory', { headers: { accept: 'application/json' } }).then((r) => r.json())
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, body: j })))
  await post(base + '/inventory/toggle', { kind: 'tool', name: 'ask_user_question', layer: 'session', enabled: false })
  await post(base + '/inventory/prompt', { name: 'harness:identity', text: 'TEMP OVERRIDE' })
  await new Promise((r) => setTimeout(r, 3500))
  const dirty = await inv()
  const reset = await post(base + '/inventory/reset', { layer: 'all' })
  await new Promise((r) => setTimeout(r, 4000))
  const clean = await inv()
  return {
    dirty: { sessionTools: dirty.disabledSessionTools, overrides: dirty.promptOverrides, tools: dirty.disabledTools },
    reset,
    clean: { sessionTools: clean.disabledSessionTools, overrides: clean.promptOverrides, tools: clean.disabledTools },
  }
})()`)
console.log(JSON.stringify(result, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
