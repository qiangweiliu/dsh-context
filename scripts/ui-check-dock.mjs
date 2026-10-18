/**
 * 检查输入框下方 ctx 指示器（conversation.composer.dock）是否渲染。
 * 用法：node scripts/ui-check-dock.mjs <url>
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9336

const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-dock-', captureConsole: true })

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
const panel = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx button not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1200))
  const segs = Array.from(document.querySelectorAll('[data-ctx-seg]')).map((el) => ({ key: el.getAttribute('data-ctx-seg'), bg: getComputedStyle(el).backgroundColor, width: el.style.width }))
  const legend = Array.from(document.querySelectorAll('[data-ctx-legend]')).map((el) => ({ key: el.getAttribute('data-ctx-legend'), text: norm(el.textContent) }))
  return { ok: true, segs, legend, body: (document.body.innerText || '').slice(0, 1200) }
})()`)
console.log(JSON.stringify({ ...snapshot, popover, panel, errors }, null, 2))
await close()
process.exit(0)
