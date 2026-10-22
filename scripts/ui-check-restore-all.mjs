import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9343
const { send, evaluate, close } = await openPage(baseUrl, { waitMs: 2000, port, profilePrefix: 'edge-rall-' })
const result = await evaluate(`(async () => {
  const base = '/api/agent-embodiment/status'
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
