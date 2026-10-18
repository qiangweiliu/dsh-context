/**
 * 给当前 UI 截图（用于 UI 对比/提案）。
 * 用法：node scripts/ui-screenshot.mjs "<url>" <out.png> [selector]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [baseUrl, outPath, selector, widthArg] = process.argv.slice(2)
if (!baseUrl || !outPath) {
  console.error('usage: node scripts/ui-screenshot.mjs <url> <out.png> [selector]')
  process.exit(2)
}
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const viewportWidth = Number(widthArg) > 0 ? Number(widthArg) : 1400
const port = 9351
const profile = mkdtempSync(join(tmpdir(), 'edge-shot-'))
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
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.id !== undefined) { const e = pending.get(m.id); if (e) { pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result) } }
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 1500, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
}
await sleep(2500)
if (selector === 'none') {
  // 保持当前页面（例如会话页看 dock）
} else if (selector === 'session') {
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const pick = (list, re) => Array.from(document.querySelectorAll(list)).find((el) => re.test(norm(el.textContent)) && norm(el.textContent).length < 200)
    const session = pick('button, [role="button"], a', /Greeting Session|Hi Greeting|Filler 1/)
    if (session) session.click()
    await new Promise((r) => setTimeout(r, 2200))
    const ctxBtn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
    if (ctxBtn) ctxBtn.click()
    await new Promise((r) => setTimeout(r, 1800))
  })()`)
} else if (selector === 'populate') {
  // 新建会话 -> 发一条 hi -> 等回复 -> 打开 ctx 页，得到有真实用量的面板
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /新建会话/.test(norm(b.getAttribute('aria-label')) || '') || /新建会话/.test(norm(b.textContent)))
    if (btn) btn.click()
    await new Promise((r) => setTimeout(r, 1200))
    const composer = document.querySelector('textarea, [contenteditable="true"]')
    if (composer) composer.focus()
  })()`)
  await send('Input.insertText', { text: 'hi' })
  await sleep(500)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
    await new Promise((r) => setTimeout(r, 300))
  })()`)
  await sleep(15000)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const ctxBtn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
    if (ctxBtn) ctxBtn.click()
    await new Promise((r) => setTimeout(r, 2200))
  })()`)
} else if (selector === 'empty') {
  // 新建空会话 -> 打开 ctx 页，检查空态布局
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /新建会话/.test(norm(b.getAttribute('aria-label')) || '') || /新建会话/.test(norm(b.textContent)))
    if (btn) btn.click()
    await new Promise((r) => setTimeout(r, 1500))
    const ctxBtn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
    if (ctxBtn) ctxBtn.click()
    await new Promise((r) => setTimeout(r, 1800))
  })()`)
} else if (selector === 'dock') {
  // 新建会话 -> 发 hi 产生用量 -> 打开 composer 下的 dock 弹层
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /新建会话/.test(norm(b.getAttribute('aria-label')) || '') || /新建会话/.test(norm(b.textContent)))
    if (btn) btn.click()
    await new Promise((r) => setTimeout(r, 1200))
    const composer = document.querySelector('textarea, [contenteditable="true"]')
    if (composer) composer.focus()
  })()`)
  await send('Input.insertText', { text: 'hi' })
  await sleep(500)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
    await new Promise((r) => setTimeout(r, 300))
  })()`)
  await sleep(15000)
  await evaluate(`(async () => {
    const trigger = document.querySelector('[data-ctx-dock]')
    if (trigger) trigger.click()
    await new Promise((r) => setTimeout(r, 1200))
  })()`)
} else if (selector) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({block:'start'}) })()`)
  await sleep(600)
} else {
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
    if (btn) btn.click()
    await new Promise((r) => setTimeout(r, 1500))
  })()`)
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log('saved', outPath)
try { await send('Browser.close') } catch {}
ws.close(); child.kill(); await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
