/**
 * 验证工具/提示词两级折叠 + 展开内容。
 * 用法：node scripts/ui-check-inventory-detail.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9340
const profile = mkdtempSync(join(tmpdir(), 'edge-det-'))
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value }
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(300)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const b=Array.from(document.querySelectorAll('button')).find((x)=>/新建会话/.test(x.getAttribute('aria-label')||'')); if (b) b.click(); await new Promise((r)=>setTimeout(r,1000)) })()`)
await sendMessage('hi')
await sleep(11000)
await sendMessage('second message so the prompt listener is installed')
await sleep(11000)

const result = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 2500))
  const sections = Array.from(document.querySelectorAll('[data-ctx-section]')).map((el) => el.getAttribute('data-ctx-section'))
  const collapsedExpands = document.querySelectorAll('[data-ctx-expand]').length
  document.querySelector('[data-ctx-section="tools"]').click()
  await new Promise((r) => setTimeout(r, 400))
  const expands = Array.from(document.querySelectorAll('[data-ctx-expand]')).map((el) => el.getAttribute('data-ctx-expand'))
  const collapsedCount = document.querySelectorAll('[data-ctx-detail]').length
  // 展开第一个工具
  const firstTool = expands.find((key) => key.startsWith('tool:'))
  let toolDetail = null
  let toolSchema = null
  if (firstTool) {
    document.querySelector('[data-ctx-expand="' + firstTool + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    toolDetail = (document.querySelector('[data-ctx-detail="' + firstTool + '"]') || {}).textContent || null
    toolSchema = (document.querySelector('[data-ctx-schema="' + firstTool + '"]') || {}).textContent || null
  }
  // 展开「提示词 section」大分区，再收起，验证折叠
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterExpand = Boolean(document.querySelector('[data-ctx-expand^="prompt:"]'))
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterCollapse = Boolean(document.querySelector('[data-ctx-expand^="prompt:"]'))
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  // 展开第一个提示词
  const promptKey = Array.from(document.querySelectorAll('[data-ctx-expand]')).map((el) => el.getAttribute('data-ctx-expand')).find((key) => key.startsWith('prompt:'))
  let promptText = null
  let promptCopy = false
  if (promptKey) {
    document.querySelector('[data-ctx-expand="' + promptKey + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    promptText = (document.querySelector('[data-ctx-detail="' + promptKey + '"]') || {}).textContent || null
    promptCopy = Boolean(document.querySelector('[data-ctx-detail="' + promptKey + '"]') && document.querySelectorAll('button').length > 0)
  }
  return {
    ok: true,
    sections,
    collapsedExpands,
    expandsCount: expands.length,
    collapsedCount,
    firstTool,
    toolDetailLength: toolDetail ? toolDetail.length : 0,
    toolSchemaLength: toolSchema ? toolSchema.length : 0,
    toolSchemaHead: toolSchema ? toolSchema.slice(0, 120) : null,
    promptsVisibleAfterExpand,
    promptsVisibleAfterCollapse,
    promptKey,
    promptTextLength: promptText ? promptText.length : 0,
    promptTextHead: promptText ? promptText.slice(0, 120) : null,
    promptCopy,
  }
})()`)

console.log(JSON.stringify({ result, errors }, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
