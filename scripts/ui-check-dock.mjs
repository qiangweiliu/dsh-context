/**
 * 检查输入框下方 ctx 指示器（conversation.composer.dock）是否渲染。
 * 用法：node scripts/ui-check-dock.mjs <url>
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2]
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9336
const profile = mkdtempSync(join(tmpdir(), 'edge-dock-'))
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)

// 新建会话（进入 composer 变体，dock 才会挂载）
const newSession = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /新建会话/.test(norm(b.getAttribute('aria-label')) || '') || /新建会话/.test(norm(b.textContent)))
  if (!btn) return false
  btn.click()
  await new Promise((r) => setTimeout(r, 1500))
  return true
})()`)

const focus = await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (!c) return false; c.focus(); return document.activeElement === c })()`)
let afterMessage = null
if (focus) {
  // 先发一条普通消息，让 UI 从 Hero 切到带 composer 的会话视图（dock 只在 composer 变体渲染）
  await send('Input.insertText', { text: 'hi' })
  await sleep(500)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
  })()`)
  await sleep(12000)
  afterMessage = await evaluate(`(() => {
    const dock = document.querySelector('[data-ctx-dock]')
    return { dockPresent: Boolean(dock), dockText: dock ? (dock.textContent || '').trim() : null, heroVisible: (document.body.innerText || '').includes('探索未至之境'), body: (document.body.innerText || '').slice(0, 900) }
  })()`)

  // 再执行 /ctx，确认测量值进入面板
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text: '/ctx' })
  await sleep(900)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, [role="button"]'))
    const hit = items.find((el) => { const t = norm(el.textContent); return t && t.length < 80 && t.includes('ctx') && !el.closest('[contenteditable="true"], textarea') })
    if (hit) hit.click()
  })()`)
  await sleep(800)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
  })()`)
  await sleep(5000)
}

const snapshot = await evaluate(`(() => {
  const dock = document.querySelector('[data-ctx-dock]')
  const style = dock ? getComputedStyle(dock) : null
  return {
    newSession: ${JSON.stringify(newSession)},
    afterMessage: ${JSON.stringify(afterMessage)},
    dockPresent: Boolean(dock),
    dockText: dock ? (dock.textContent || '').trim() : null,
    dockStyle: style ? {
      fontSize: style.fontSize,
      fontVariantNumeric: style.fontVariantNumeric,
      color: style.color,
      borderRadius: style.borderRadius,
      padding: style.padding,
      display: style.display,
    } : null,
    dockRect: dock ? { w: Math.round(dock.getBoundingClientRect().width), h: Math.round(dock.getBoundingClientRect().height) } : null,
    heroVisible: (document.body.innerText || '').includes('探索未至之境'),
    body: (document.body.innerText || '').slice(0, 1200),
  }
})()`)

// 点开 dock 的弹出明细
const popover = await evaluate(`(async () => {
  const dock = document.querySelector('[data-ctx-dock]')
  if (!dock) return { ok: false, why: 'no dock' }
  dock.click()
  await new Promise((r) => setTimeout(r, 500))
  const panel = document.querySelector('[role="dialog"]')
  const style = panel ? getComputedStyle(panel) : null
  return {
    ok: Boolean(panel),
    text: panel ? (panel.textContent || '').replace(/\\s+/g, ' ').trim() : null,
    style: style ? { width: style.width, borderRadius: style.borderRadius, background: style.backgroundColor, fontSize: style.fontSize, padding: style.padding } : null,
  }
})()`)
console.log(JSON.stringify({ ...snapshot, popover, errors }, null, 2))
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
