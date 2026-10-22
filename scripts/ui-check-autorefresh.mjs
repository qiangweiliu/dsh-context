/**
 * 验证 dock 事件驱动刷新：空闲不轮询；发消息后自动刷新（无需点击）。
 * 用法：node scripts/ui-check-autorefresh.mjs <url>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9353
const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-auto-' })
const liveCount = () => evaluate(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/status/live')).length`)
const dockText = () => evaluate(`(() => { const el = document.querySelector('[data-embodiment-dock]'); return el ? el.textContent.trim() : null })()`)
const sendMessage = (text) => sendText({ send, evaluate }, text)

await evaluate(`(async () => { const b = Array.from(document.querySelectorAll('button')).find((x) => /新建会话/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
await sendMessage('hi')
await sleep(12000)
const c1 = await liveCount()
const t1 = await dockText()
await sleep(7000) // 空闲：不应有轮询请求
const c2 = await liveCount()
await sendMessage('second message triggers auto refresh')
await sleep(5000)
const c3 = await liveCount()
const t2 = await dockText()
console.log(JSON.stringify({ c1, dockAfterFirst: t1, c2, idleGrowth: c2 - c1, c3, afterSecondGrowth: c3 - c2, dockAfterSecond: t2, errors }, null, 2))
await close()
process.exit(0)
