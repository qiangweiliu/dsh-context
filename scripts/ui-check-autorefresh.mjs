/**
 * 验证 dock 事件驱动刷新：空闲不轮询；发消息后自动刷新（无需点击）。
 * 用法：node scripts/ui-check-autorefresh.mjs <url>
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9353
const { send, evaluate, errors, close } = await openCdp({ port, profilePrefix: 'edge-auto-' })
const liveCount = () => evaluate(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/status/live')).length`)
const dockText = () => evaluate(`(() => { const el = document.querySelector('[data-ctx-dock]'); return el ? el.textContent.trim() : null })()`)
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(350)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
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
