/**
 * 上下文超限测试 v2：用 /live 读实时比例，检查 dock 文本/颜色、面板、控制状态与长文本触发。
 * 用法：node scripts/ui-check-limit2.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9355
const profile = mkdtempSync(join(tmpdir(), 'edge-limit2-'))
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
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(400)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
const live = async () => (await api('/api/ctx-mon-and-con/status/live')).body
const status = async () => (await api('/api/ctx-mon-and-con/status')).body
const dock = async () => evaluate(`(() => { const el = document.querySelector('[data-ctx-dock]'); if (!el) return null; return { text: el.textContent.trim(), color: getComputedStyle(el).color } })()`)

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)

const out = { errors, phases: {} }
const setBudget = async (tokens) => { await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: tokens, warnAt: 0.7, errorAt: 0.9 }); await sleep(5000) }
const waitFor = async (fn, timeoutMs, stepMs = 2000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const v = await fn().catch(() => null); if (v) return v; await sleep(stepMs) } return null }

// A. 超限后自动压缩
await setBudget(3000)
await sendMessage('hi from limit test')
const compacted = await waitFor(async () => { const s = await status(); return s?.control?.lastCompaction ? s : null }, 45000)
await sleep(3000)
const l1 = await live()
out.phases.autoCompact = { compacted: compacted ? compacted.control.lastCompaction : null, live: l1, dock: await dock() }

// B. 超限 UI（关控制）
await api('/api/ctx-mon-and-con/status/config/preset', { enable: false })
await sleep(6000)
await setBudget(3000)
await sendMessage('stay over limit with control disabled')
await sleep(12000)
const l2 = await live()
const d2 = await dock()
await sendMessage('/ctx')
await sleep(4000)
const ctxBody = await evaluate('(document.body.innerText || "").slice(0, 4000)')
out.phases.overUi = { live: l2, dock: d2, ctxCommandHasOver: ctxBody.includes('超限') }
await api('/api/ctx-mon-and-con/status/config/preset', { enable: true })
await sleep(6000)

// C. 长文本压力（预算 20000）
await setBudget(20000)
const before = await status()
const big = 'Context stress test. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(450)
const t1 = new Date().toISOString()
await sendMessage(big)
const stressed = await waitFor(async () => {
  const s = await status()
  const last = s?.control?.lastCompaction
  return last && new Date(last.at).getTime() > new Date(t1).getTime() ? s : null
}, 120000, 3000)
out.phases.longText = { chars: big.length, compacted: stressed ? stressed.control.lastCompaction : null, live: await live(), dock: await dock() }

// D. 还原
await setBudget(128000)
out.restored = (await status())?.budget
console.log(JSON.stringify(out, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
