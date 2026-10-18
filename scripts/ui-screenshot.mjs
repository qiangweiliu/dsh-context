/**
 * 给当前 UI 截图（用于 UI 对比/提案）。
 * 用法：node scripts/ui-screenshot.mjs "<url>" <out.png> [selector|none] [width]
 *
 * selector 是 CSS 选择器；只做滚动定位，不做页面准备。需要先登录、发消息或
 * 切主题时，用 scripts/ui-check-*.mjs 或 scripts/ui-probe.mjs 准备好页面后再截图。
 */
import { writeFileSync } from 'node:fs'
import { openCdp, sleep } from './lib/cdp.mjs'

const [baseUrl, outPath, selector, widthArg] = process.argv.slice(2)
if (!baseUrl || !outPath) {
  console.error('usage: node scripts/ui-screenshot.mjs <url> <out.png> [selector|none] [width]')
  process.exit(2)
}
const viewportWidth = Number(widthArg) > 0 ? Number(widthArg) : 1400

const { send, evaluate, close } = await openCdp({ port: 9351, profilePrefix: 'edge-shot-' })
await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 1500, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break
}
await sleep(2500)
if (selector && selector !== 'none') {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'start' }) })()`)
  await sleep(600)
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log('saved', outPath)
await close()
