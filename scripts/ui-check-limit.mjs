/**
 * 上下文超限测试：低预算触发 idle 自动压缩、UI 超限状态、压缩后会话可用、长文本压力。
 * 用法：node scripts/ui-check-limit.mjs <url>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9354
const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-limit-', captureConsole: true })
const sendMessage = (text) => sendText({ send, evaluate }, text)
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
const status = async () => (await api('/api/ctx-mon-and-con/status')).body
const bool = (value) => Boolean(value)

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
await close()
process.exit(0)
