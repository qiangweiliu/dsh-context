/**
 * 会话级开关持久化：setup 设置开关，重启后 verify 恢复并按 sessionId 读取。
 * 用法：node scripts/ui-check-session-persist.mjs <url> <setup|verify>
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const phase = process.argv[3]
const port = phase === 'setup' ? 9347 : 9348
const { send, evaluate, errors, close } = await openCdp({ port, profilePrefix: `edge-sess-${phase}-` })
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
await close()
process.exit(0)
