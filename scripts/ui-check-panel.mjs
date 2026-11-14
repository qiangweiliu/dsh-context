/**
 * 面板渲染检查：按指定窗口尺寸加载 web 实例，点开「上下文」并断言四 tab/内容/无异常。
 * 用法：node scripts/ui-check-panel-size.mjs <url> [width] [height]
 * 同时把顶层渲染异常原样打出来（若有）。
 */
import { writeFileSync } from 'node:fs'
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const W = Number(process.argv[3] || 1776)
const H = Number(process.argv[4] || 1250)
const port = 9343
const OUT = `/mnt/c/Users/40410/Desktop/context/.tmp-panel-${W}x${H}.png`

const { send, evaluate, errors, exceptions, consoleLines, close } = await openCdp({
  port,
  profilePrefix: 'edge-size-',
  captureConsole: true,
  captureAllConsole: true,
})

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: baseUrl })

for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  try {
    if (await evaluate("document.readyState === 'complete' && !!document.body && document.body.children.length > 0")) break
  } catch {}
}
await sleep(3000)

await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^(Continue|继续|知道了|Got it)$/.test((x.textContent || '').trim()))
  if (b) { b.click(); return true }
  return false
})()`)
await sleep(800)

const clicked = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const els = [...document.querySelectorAll('button,[role="button"],[role="tab"],a')]
  const hit = els.find((e) => {
    const t = norm(e.textContent)
    const a = norm(e.getAttribute('aria-label'))
    return t === '上下文' || t === 'Context' || a === '上下文' || a === 'Context'
  })
  if (!hit) return { ok: false }
  hit.click()
  await new Promise((r) => setTimeout(r, 2000))
  return { ok: true, label: norm(hit.textContent) || norm(hit.getAttribute('aria-label')) }
})()`)
await sleep(1500)

const info = await evaluate(`(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const panels = [...document.querySelectorAll('[data-embodiment-panel]')]
  const describe = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left),
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      offsetParentNull: el.offsetParent === null,
      textLen: norm(el.innerText).length, tabs: el.querySelectorAll('[role="tab"]').length,
    }
  }
  return {
    viewport: { w: innerWidth, h: innerHeight },
    panelCount: panels.length,
    panels: panels.map(describe),
    bodyTextLen: (document.body.innerText || '').length,
    bodySample: norm(document.body.innerText).slice(0, 200),
    version: document.querySelector('[data-embodiment-version]')?.getAttribute('data-embodiment-version') || null,
  }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify({
  size: `${W}x${H}`,
  clicked,
  info,
  errorCount: errors.length,
  exceptionCount: exceptions.length,
  errors: errors.slice(0, 6),
  exceptions: exceptions.slice(0, 3),
  consoleTail: consoleLines.slice(-6),
  screenshot: OUT,
}, null, 2))
await close()
process.exit(0)
