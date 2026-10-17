/**
 * 持久化验证：全局提示词覆盖 / 全局工具禁用 → 重启后是否保留；会话级开关 → 重启后是否丢失。
 * 用法：node scripts/ui-check-persistence.mjs <url> <setup|verify>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const phase = process.argv[3]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = phase === 'setup' ? 9345 : 9346
const profile = mkdtempSync(join(tmpdir(), `edge-persist-${phase}-`))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OVERRIDE = 'PERSIST-TEST-PROMPT'

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

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2000)

const api = async (path, body) => evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(path)}, ${body === undefined ? '{ headers: { accept: "application/json" } }' : JSON.stringify({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })})
  return r.json().catch(() => null)
})()`)

let out = { phase, errors }
if (phase === 'setup') {
  const before = await api('/api/ctx-mon-and-con/status/inventory')
  const sessionId = before && before.sessionId
  await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
  await sendMessage('hi')
  await sleep(10000)
  await sendMessage('second message so inventory is recorded')
  await sleep(10000)
  const t1 = await api('/api/ctx-mon-and-con/status/inventory/prompt', { name: 'harness:identity', text: OVERRIDE })
  const t2 = await api('/api/ctx-mon-and-con/status/inventory/toggle', { kind: 'tool', name: 'ask_user_question', layer: 'global', enabled: false })
  const t3 = await api('/api/ctx-mon-and-con/status/inventory/toggle', { kind: 'tool', name: 'bash', layer: 'session', enabled: false })
  await sleep(5000)
  const after = await api('/api/ctx-mon-and-con/status/inventory')
  out = { ...out, sessionId: after && after.sessionId, set: [t1 && t1.ok, t2 && t2.ok, t3 && t3.ok], promptOverrides: after && after.promptOverrides, disabledTools: after && after.disabledTools, disabledSessionTools: after && after.disabledSessionTools }
} else {
  // 重启后、尚未发请求时：配置应已加载，inventory 应为 null
  const cold = await api('/api/ctx-mon-and-con/status/inventory')
  await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
  await sendMessage('hi after restart')
  await sleep(10000)
  await sendMessage('second message after restart')
  await sleep(10000)
  const warm = await api('/api/ctx-mon-and-con/status/inventory')
  const sections = warm && warm.inventory ? warm.inventory.sections : []
  const tools = warm && warm.inventory ? warm.inventory.tools : []
  const identity = sections.find((s) => s.name === 'harness:identity')
  const oldSession = process.env.PERSIST_OLD_SESSION
  const oldState = oldSession ? await api(`/api/ctx-mon-and-con/status/inventory?sessionId=${encodeURIComponent(oldSession)}`) : null
  out = {
    ...out,
    cold: { inventory: cold && cold.inventory, promptOverrides: cold && cold.promptOverrides, disabledTools: cold && cold.disabledTools },
    warm: {
      identityText: identity ? identity.text.slice(0, 60) : null,
      identityOverridden: identity ? Boolean(identity.overridden) : null,
      hasAskUserQuestion: tools.some((t) => t.name === 'ask_user_question'),
      toolCount: tools.length,
      disabledSessionTools: warm && warm.disabledSessionTools,
    },
    oldSessionState: oldState ? { disabledSessionTools: oldState.disabledSessionTools } : null,
  }
  // 清理：清掉全局覆盖与全局工具禁用
  await api('/api/ctx-mon-and-con/status/inventory/reset', { layer: 'all' })
  await sleep(4000)
  const cleaned = await api('/api/ctx-mon-and-con/status/inventory')
  out.cleaned = { promptOverrides: cleaned && cleaned.promptOverrides, disabledTools: cleaned && cleaned.disabledTools }
}

console.log(JSON.stringify(out, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
