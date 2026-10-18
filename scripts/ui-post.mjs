/**
 * 在已认证页面上下文里 POST 一个 JSON。body 参数可用：on / off（-> {enable:true/false}）或一段 JSON。
 * 用法：node scripts/ui-post.mjs <url> <path> <body>
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const [baseUrl, apiPath, bodyText] = process.argv.slice(2)
let payload
if (bodyText === 'on') payload = { enable: true }
else if (bodyText === 'off') payload = { enable: false }
else payload = JSON.parse(bodyText)
const bodyJson = JSON.stringify(payload)

const port = 9352
const { send, evaluate, close } = await openCdp({ port, profilePrefix: 'edge-post-' })
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2000)
const result = await evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(apiPath)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(bodyJson)} })
  return { status: r.status, body: await r.json().catch(() => null) }
})()`)
console.log(JSON.stringify(result, null, 2))
await close()
process.exit(0)
