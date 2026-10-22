import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9342
const { send, evaluate, close } = await openPage(baseUrl, { waitMs: 2000, port, profilePrefix: 'edge-papi-' })
const result = await evaluate(`(async () => {
  const inv = () => fetch('/api/agent-embodiment/status/inventory', { headers: { accept: 'application/json' } }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
  const before = await inv()
  const edit = await fetch('/api/agent-embodiment/status/inventory/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'harness:identity', text: 'TEST OVERRIDE VIA API' }) }).then((r) => r.json().then((j) => ({ status: r.status, body: j }))).catch((e) => ({ error: String(e) }))
  await new Promise((r) => setTimeout(r, 4000))
  const after = await inv()
  const sections = after.inventory ? after.inventory.sections : []
  const target = sections.find((s) => s.name === 'harness:identity') || null
  const reset = await fetch('/api/agent-embodiment/status/inventory/prompt/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json().then((j) => ({ status: r.status, body: j }))).catch((e) => ({ error: String(e) }))
  await new Promise((r) => setTimeout(r, 4000))
  const final = await inv()
  const finalTarget = final.inventory ? final.inventory.sections.find((s) => s.name === 'harness:identity') : null
  return { before: { promptWrite: before.promptWrite, overrides: before.promptOverrides }, edit, after: { promptWrite: after.promptWrite, overrides: after.promptOverrides, target }, reset, final: { overrides: final.promptOverrides, finalTarget } }
})()`)
console.log(JSON.stringify(result, null, 2))
await close()
process.exit(0)
