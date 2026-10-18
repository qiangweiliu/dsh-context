/**
 * 验证：不执行 /ctx 时，侧栏 ctx 整页也显示实时用量与四色构成（与 dock 同源）。
 * 用法：node scripts/ui-check-panel-live.mjs <url>
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9337

const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-live-', captureConsole: true })

await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /新建会话/.test(norm(b.getAttribute('aria-label')) || '') || /新建会话/.test(norm(b.textContent)))
  if (btn) btn.click()
  await new Promise((r) => setTimeout(r, 1200))
  const composer = document.querySelector('textarea, [contenteditable="true"]')
  if (composer) composer.focus()
  return Boolean(composer)
})()`)
await send('Input.insertText', { text: 'hi' })
await sleep(400)
await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
  if (b) b.click()
})()`)
await sleep(12000)

const snapshot = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const readSegs = () => Array.from(document.querySelectorAll('[data-ctx-seg]')).map((el) => ({ key: el.getAttribute('data-ctx-seg'), bg: getComputedStyle(el).backgroundColor, inline: el.style.width, computed: Math.round(parseFloat(getComputedStyle(el).width) * 100) / 100 }))
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 120))
  const early = readSegs()
  await new Promise((r) => setTimeout(r, 1100))
  const segs = readSegs()
  const legend = Array.from(document.querySelectorAll('[data-ctx-legend]')).map((el) => norm(el.textContent))
  return { ok: true, early, segs, legend, body: (document.body.innerText || '').slice(0, 1000) }
})()`)

console.log(JSON.stringify({ ...snapshot, errors }, null, 2))
await close()
process.exit(0)
