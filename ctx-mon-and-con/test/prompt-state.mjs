/**
 * 提示词状态回归：连续写不能互相覆盖；会话覆盖必须压过旧的 inventory 快照。
 *
 * 运行：node test/prompt-state.mjs
 * 前提：test/deps/dsh/node_modules/@deepseek-ai/{cordis,cosmokit} 存在。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const testHome = mkdtempSync(join(tmpdir(), 'ctx-prompt-home-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

const depsRoot = new URL('./deps/dsh/node_modules/@deepseek-ai/', import.meta.url)
const cordisEntry = new URL('cordis/lib/index.js', depsRoot)
if (!existsSync(fileURLToPath(cordisEntry))) {
  console.error(`[prompt-state] 缺少 ${fileURLToPath(cordisEntry)}；先运行 node test/prepare-deps.mjs`)
  process.exit(2)
}

const { Context, Service } = await import(cordisEntry.href)
const plugin = await import(new URL('../index.js', import.meta.url).href)
const state = await import(new URL('../state.js', import.meta.url).href)

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class MockCommands extends Service {
  constructor(ctx) {
    super(ctx, 'commands')
  }
  register() {
    return () => {}
  }
}
class MockTokenMeter extends Service {
  constructor(ctx) {
    super(ctx, 'tokenMeter')
  }
  measure() {
    return { totalTokens: 1, surfaceTokens: 1, baseline: { kind: 'test', tokens: 1 }, nodes: [] }
  }
}
class MockWebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    this.routes = new Map()
  }
  register(route) {
    this.routes.set(route.path, route)
    return () => this.routes.delete(route.path)
  }
}
class MockSessions extends Service {
  constructor(ctx) {
    super(ctx, 'sessions')
  }
  list() {
    return [{ id: 'prompt-test' }]
  }
  get(id) {
    return id === 'prompt-test' ? { id } : undefined
  }
}
class MockConfigEditor extends Service {
  constructor(ctx) {
    super(ctx, 'configEditor')
    this.entry = { options: { id: 'ctx-mon-and-con', config: { promptOverrides: {}, extraPrompts: {}, extraPromptPlacements: {} } } }
    this.writes = 0
  }
  entries() {
    return [this.entry]
  }
  async edit(entry, mutate) {
    this.writes += 1
    await sleep(10)
    entry.options.config = mutate(entry.options.config)
  }
}

const root = new Context()
await root.plugin(MockCommands)
await root.plugin(MockTokenMeter)
await root.plugin(MockWebServer)
await root.plugin(MockSessions)
await root.plugin(MockConfigEditor)
const editor = root.get('configEditor')
const webServer = root.get('webServer')
const fiber = root.plugin(plugin, { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9 })
await fiber
await sleep(0)

const makeResponse = () => {
  let finish
  const done = new Promise((resolve) => { finish = resolve })
  return {
    statusCode: 0,
    headers: {},
    body: '',
    done,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(body) { this.body = body ?? ''; finish() },
  }
}
const call = async (path, method, body) => {
  const route = webServer.routes.get(path.split('?')[0])
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  request.url = path
  const response = makeResponse()
  route.handler(request, response)
  await response.done
  return { status: response.statusCode, payload: response.body ? JSON.parse(response.body) : null }
}

state.recordInventory('prompt-test', {
  sections: [{ name: 'harness:identity', tokens: 4, text: 'BASE', originalText: 'BASE' }],
  tools: [],
})
state.setSessionPromptText('prompt-test', 'harness:identity', 'SESSION-TEXT')
const inventory = await call('/api/ctx-mon-and-con/status/inventory?sessionId=prompt-test', 'GET')
const section = inventory.payload?.inventory?.sections?.[0]
check('inventory 叠上会话覆盖', section?.sessionOverridden === true && section?.text === 'SESSION-TEXT', JSON.stringify(section))
check('inventory 来源是稳定包名', inventory.payload?.inventory?.sources?.sections?.['harness:identity'] === '@deepseek-ai/dsh-system-prompt', JSON.stringify(inventory.payload?.inventory?.sources))

const sessionReset = await call('/api/ctx-mon-and-con/status/inventory/prompt/session/reset', 'POST', { name: 'harness:identity', sessionId: 'prompt-test' })
const afterSessionReset = await call('/api/ctx-mon-and-con/status/inventory?sessionId=prompt-test', 'GET')
const resetSection = afterSessionReset.payload?.inventory?.sections?.[0]
check('会话复位只清会话覆盖', sessionReset.status === 202 && resetSection?.sessionOverridden === false && resetSection?.text === 'BASE', JSON.stringify(resetSection))

const promptPath = '/api/ctx-mon-and-con/status/inventory/prompt'
const [first, second] = await Promise.all([
  call(promptPath, 'POST', { name: 'deployment:persona-suffix', text: 'ONE' }),
  call(promptPath, 'POST', { name: 'tool:bash', text: 'TWO' }),
])
check('两次连续写入都返回 202', first.status === 202 && second.status === 202, `${first.status}/${second.status}`)
await sleep(80)
const saved = editor.entry.options.config.promptOverrides
check('连续写入不丢前一次', saved['deployment:persona-suffix'] === 'ONE' && saved['tool:bash'] === 'TWO', JSON.stringify(saved))
check('配置写队列串行落盘', editor.writes === 2, editor.writes)

const after = await call('/api/ctx-mon-and-con/status/inventory?sessionId=prompt-test', 'GET')
const afterSection = after.payload?.inventory?.sections?.[0]
check('inventory 读当前运行时覆盖', after.payload?.promptOverrides?.['tool:bash'] === 'TWO', JSON.stringify(after.payload?.promptOverrides))

const reset = await call('/api/ctx-mon-and-con/status/inventory/reset', 'POST', { layer: 'global' })
await sleep(80)
check('全局恢复清空运行时覆盖', reset.status === 202 && Object.keys(editor.entry.options.config.promptOverrides || {}).length === 0, JSON.stringify(editor.entry.options.config.promptOverrides))
const cleared = await call('/api/ctx-mon-and-con/status/inventory?sessionId=prompt-test', 'GET')
check('恢复后 promptOverrides 为空', Object.keys(cleared.payload?.promptOverrides || {}).length === 0, JSON.stringify(cleared.payload?.promptOverrides))

await fiber.dispose()
await root.fiber.dispose()
try { rmSync(testHome, { recursive: true, force: true }) } catch {}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[prompt-state] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[prompt-state] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exit(1)
}
