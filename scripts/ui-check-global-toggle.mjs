import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9339
const { send, evaluate, close } = await openCdp({ port, profilePrefix: 'edge-glob-' })
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
const result = await evaluate(`(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, body: j }))).catch((e) => ({ error: String(e) }))
  const before = await fetch('/api/ctx-mon-and-con/status/inventory').then((r) => r.json()).catch(() => null)
  const toggle = await post('/api/ctx-mon-and-con/status/inventory/toggle', { kind: 'tool', name: 'ask_user_question', layer: 'global', enabled: true })
  await new Promise((r) => setTimeout(r, 4000))
  const after = await fetch('/api/ctx-mon-and-con/status/inventory').then((r) => r.json()).catch(() => null)
  return { toggle, before, after }
})()`)
console.log(JSON.stringify(result, null, 2))
await close()
process.exit(0)
