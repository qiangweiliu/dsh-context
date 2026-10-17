/**
 * 上下文超限测试：低预算触发 idle 自动压缩、UI 超限状态、压缩后会话可用、长文本压力。
 * 用法：node scripts/ui-check-limit.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9354
const profile = mkdtempSync(join(tmpdir(), 'edge-limit-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 60 && !page; i += 1) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}; if (!page) await sleep(200) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
})
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
const status = async () => (await api('/api/ctx-mon-and-con/status')).body
const bool = (value) => Boolean(value)

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)

const out = { phases: {}, errors }
const setBudget = async (tokens) => {
  const r = await api('/api/ctx-mon-and-con/status/config', { contextWindowTokens: tokens, warnAt: 0.7, errorAt: 0.9 })
  await sleep(5000)
  return r
}
const waitFor = async (fn, timeoutMs, stepMs = 1500) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null)
    if (value) return value
    await sleep(stepMs)
  }
  return null
}

// ── A. 低预算 + idle 自动压缩 ───────────────────────────────────────────
await setBudget(3000)
const before = await status()
const t0 = new Date().toISOString()
await sendMessage('hi, this message is only used to exceed a 3000-token limit')
const compacted = await waitFor(async () => {
  const s = await status()
  const last = s && s.control && s.control.lastCompaction
  return last ? { s, last, after: last.after, before: last.before } : null
}, 45000)
out.phases.lowBudgetAutoCompact = {
  beforeBudget: before && before.budget,
  compacted: compacted
    ? { before: compacted.before, after: compacted.after, at: compacted.s?.control?.lastCompactionAt }
    : null,
  measured: compacted ? (compacted.s.measurements[0] || null) : null,
  controlActive: before && before.control && before.control.active,
}

// 压缩后会话继续可用
await sendMessage('second message after compaction – are you there?')
await sleep(15000)
const afterSecond = await status()
out.phases.usableAfterCompact = {
  measurements: afterSecond && afterSecond.measurements && afterSecond.measurements.length,
  lastCompact: afterSecond && afterSecond.control && afterSecond.control.lastCompactionAt,
  sessionIds: afterSecond && afterSecond.measurements && afterSecond.measurements.slice(0, 2).map((m) => m.id),
}

// ── B. UI 超限状态（临时关控制半侧，避免立即被压掉）──────────────────────
await api('/api/ctx-mon-and-con/status/config/preset', { enable: false })
await sleep(6000)
await setBudget(3000)
await sendMessage('this turn should stay over the context limit because control is off')
await sleep(12000)
const over = await status()
await sendMessage('/ctx')
await sleep(5000)
const overBody = await evaluate('(document.body.innerText || "").slice(0, 4000)')
const dockColor = await evaluate(`(() => { const el = document.querySelector('[data-ctx-dock]'); return el ? getComputedStyle(el).color : null })()`)
out.phases.overLimitUi = {
  ratio: over && over.measurements && over.measurements[0] ? over.measurements[0].ratio : null,
  budget: over && over.budget && over.budget.tokens,
  statusText: overBody.includes('超限') ? '超限' : overBody.includes('警告') ? '警告' : 'unknown',
  dockColor,
  controlActive: over && over.control && over.control.active,
}
await api('/api/ctx-mon-and-con/status/config/preset', { enable: true })
await sleep(6000)

// ── C. 长文本压力（真实大消息）──────────────────────────────────────────
await setBudget(20000)
const big = 'Context stress test. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(500)
const t1 = new Date().toISOString()
await sendMessage(big)
const stressed = await waitFor(async () => {
  const s = await status()
  const last = s && s.control && s.control.lastCompaction
  return last && last.at && last.at > t1 ? { s, last } : null
}, 90000, 3000)
out.phases.longTextStress = {
  bigChars: big.length,
  compacted: stressed ? { before: stressed.last.before, after: stressed.last.after, at: stressed.last.at } : null,
  usageAfter: stressed ? (stressed.s.measurements[0] || null) : null,
}

// ── D. 还原预算 ─────────────────────────────────────────────────────────
await setBudget(128000)
const restored = await status()
out.restored = restored && restored.budget
console.log(JSON.stringify(out, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
