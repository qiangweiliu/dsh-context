/**
 * 验证 ctx 页面标题旁显示插件版本号（data-ctx-version）。
 * 用法：node scripts/ui-check-version.mjs "<baseUrl 含 token>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/ui-check-version.mjs <url>')
  process.exit(2)
}
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9347
const profile = mkdtempSync(join(tmpdir(), 'edge-version-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page
for (let i = 0; i < 60 && !page; i += 1) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}
  if (!page) await sleep(200)
}
if (!page) { console.error('no devtools page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
}
await sleep(2500)

const result = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1500))
  const chip = document.querySelector('[data-ctx-version]')
  const panel = document.querySelector('[data-ctx-panel]')
  const titleEl = panel ? panel.querySelector('h2') : null
  return {
    ok: Boolean(chip),
    version: chip ? norm(chip.textContent) : null,
    title: titleEl ? norm(titleEl.textContent) : null,
    chipTitleAttr: chip ? chip.getAttribute('title') : null,
    panelPresent: Boolean(panel),
    body: (document.body.innerText || '').slice(0, 400),
  }
})()`)

console.log(JSON.stringify({ ...result, errors }, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(result.ok ? 0 : 1)
