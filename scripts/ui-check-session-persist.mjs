/**
 * 会话级开关持久化：setup 设置开关，重启后 verify 恢复并按 sessionId 读取。
 * 用法：node scripts/ui-check-session-persist.mjs <url> <setup|verify>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const phase = process.argv[3]
const port = phase === 'setup' ? 9347 : 9348
const { send, evaluate, errors, close } = await openPage(baseUrl, { waitMs: 2000, port, profilePrefix: `edge-sess-${phase}-` })
const sendMessage = (text) => sendText({ send, evaluate }, text)
const api = (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return r.json().catch(() => null)
})()`)


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
await close()
process.exit(0)
