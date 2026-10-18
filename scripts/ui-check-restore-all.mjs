import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9343
const { send, evaluate, close } = await openCdp({ port, profilePrefix: 'edge-rall-' })
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2000)
const result = await evaluate(`(async () => {
  const base = '/api/ctx-mon-and-con/status'
  const inv = () => fetch(base + '/inventory', { headers: { accept: 'application/json' } }).then((r) => r.json())
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, body: j })))
  await post(base + '/inventory/toggle', { kind: 'tool', name: 'ask_user_question', layer: 'session', enabled: false })
  await post(base + '/inventory/prompt', { name: 'harness:identity', text: 'TEMP OVERRIDE' })
  await new Promise((r) => setTimeout(r, 3500))
  const dirty = await inv()
  const reset = await post(base + '/inventory/reset', { layer: 'all' })
  await new Promise((r) => setTimeout(r, 4000))
  const clean = await inv()
  return {
    dirty: { sessionTools: dirty.disabledSessionTools, overrides: dirty.promptOverrides, tools: dirty.disabledTools },
    reset,
    clean: { sessionTools: clean.disabledSessionTools, overrides: clean.promptOverrides, tools: clean.disabledTools },
  }
})()`)
console.log(JSON.stringify(result, null, 2))
await close()
process.exit(0)
