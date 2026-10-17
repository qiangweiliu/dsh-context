/**
 * control.js（preset 平面的「控制」半侧）的离线测试。
 *
 * 用真实 Cordis + 三个 mock 服务顶替宿主：
 *   - tokenMeter : 按 `meter.tokens` 返回测量快照
 *   - compaction : 记录 compactNow / compactIfNeeded 调用，可注入失败
 *   - commands   : register() 返回 disposer
 *
 * 覆盖：插件形状 / 配置校验 / idle 超预算压缩 / 未超预算不动 / cooldown 节流 /
 * notify 只记录 / pre-step 触发 compactIfNeeded / /ctx-compact 命令成功与失败 /
 * 卸载后监听器与命令都被移除。
 *
 * 运行：node test/control.mjs（前提：先 node test/prepare-deps.mjs）
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const depsRoot = new URL('./deps/dsh/node_modules/@deepseek-ai/', import.meta.url)
const cordisEntry = new URL('cordis/lib/index.js', depsRoot)
if (!existsSync(fileURLToPath(cordisEntry))) {
  console.error(`[control] 缺少 ${fileURLToPath(cordisEntry)}；先运行 node test/prepare-deps.mjs`)
  process.exit(2)
}

const { Context, Service } = await import(cordisEntry.href)
const controlPlugin = await import(new URL('../control.js', import.meta.url).href)

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── mock 服务 ─────────────────────────────────────────────────────────────
class MockTokenMeter extends Service {
  constructor(ctx) {
    super(ctx, 'tokenMeter')
    this.tokens = 0
    this.calls = 0
  }
  measure(session) {
    this.calls += 1
    if (!session || typeof session !== 'object') throw new Error('measure() expects a session object')
    return Object.freeze({
      logRevision: 1,
      baseline: Object.freeze({ kind: 'estimated', tokens: this.tokens }),
      surfaceDeltaTokens: 0,
      totalTokens: this.tokens,
      surfaceTokens: this.tokens,
      nodes: Object.freeze([{ tokens: this.tokens }]),
    })
  }
}

class MockCompaction extends Service {
  constructor(ctx) {
    super(ctx, 'compaction')
    this.calls = []
    this.fail = null
    this.result = Object.freeze({ shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 5000 })
  }
  async compactNow(agent, signal) {
    this.calls.push({ kind: 'compactNow', agent, signal })
    if (this.fail) throw this.fail
    return this.result
  }
  async compactIfNeeded(agent, trigger, signal) {
    this.calls.push({ kind: 'compactIfNeeded', agent, trigger, signal })
    if (this.fail) throw this.fail
    return this.result
  }
}

class MockCommands extends Service {
  constructor(ctx) {
    super(ctx, 'commands')
    this.definitions = new Map()
  }
  register(definition) {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate command ${definition.name}`)
    this.definitions.set(definition.name, definition)
    return () => this.definitions.delete(definition.name)
  }
}

/** 搭一个根上下文 + mock 服务。 */
async function mount(config) {
  const root = new Context()
  await root.plugin(MockTokenMeter)
  await root.plugin(MockCompaction)
  await root.plugin(MockCommands)
  const meter = root.get('tokenMeter')
  const compaction = root.get('compaction')
  const commands = root.get('commands')
  const fiber = root.plugin(controlPlugin, config)
  await fiber
  const agent = { session: { id: 'control-session' } }
  return { root, fiber, meter, compaction, commands, agent }
}

// ── 1. 插件形状 ───────────────────────────────────────────────────────────
check('exports name', controlPlugin.name === 'ctx-mon-and-con-control', controlPlugin.name)
check('exports inject', controlPlugin.inject?.join(',') === 'tokenMeter', JSON.stringify(controlPlugin.inject))
check('exports Config standard schema', typeof controlPlugin.Config?.['~standard']?.validate === 'function')
check('exports apply function', typeof controlPlugin.apply === 'function')

// ── 2. idle 模式：超预算压缩一次；未超预算不动 ────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ maxContextTokens: 100000, mode: 'idle', cooldownMs: 0 })
  meter.tokens = 40000
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check('idle 未超预算不压缩', compaction.calls.length === 0, compaction.calls.length)

  meter.tokens = 180000
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check('idle 超预算调用 compactNow', compaction.calls.length === 1 && compaction.calls[0].kind === 'compactNow', JSON.stringify(compaction.calls.map((c) => c.kind)))

  meter.tokens = 180000
  root.emit('agent/status', { agent, status: 'running' })
  await tick()
  check('非 idle 状态不压缩', compaction.calls.length === 1, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 3. cooldown 节流 ──────────────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ maxContextTokens: 100000, mode: 'idle', cooldownMs: 60000 })
  meter.tokens = 180000
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check('cooldown 内只压缩一次', compaction.calls.length === 1, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 4. notify 模式只记录，不压缩 ──────────────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ maxContextTokens: 100000, mode: 'notify', cooldownMs: 0 })
  meter.tokens = 180000
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check('notify 模式不调用压缩服务', compaction.calls.length === 0, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 5. pre-step 模式：走 compactIfNeeded，且不吞掉 waterfall ───────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ maxContextTokens: 100000, mode: 'pre-step', cooldownMs: 0 })
  meter.tokens = 180000
  const signal = new AbortController().signal
  const returned = await root.waterfall('agent/pre-step', { agent, signal }, () => 'inner-reached')
  check('pre-step 调用 compactIfNeeded(pressure)', compaction.calls.length === 1 && compaction.calls[0].kind === 'compactIfNeeded' && compaction.calls[0].trigger === 'pressure', JSON.stringify(compaction.calls.map((c) => `${c.kind}:${c.trigger}`)))
  check('pre-step 继续 waterfall 链', returned === 'inner-reached', String(returned))

  meter.tokens = 5000
  const returned2 = await root.waterfall('agent/pre-step', { agent, signal }, () => 'inner-reached')
  check('未超预算时不压缩但继续链', compaction.calls.length === 1 && returned2 === 'inner-reached', `${compaction.calls.length}/${returned2}`)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 6. 压缩失败不影响轮次（pre-step 吞掉异常）─────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ maxContextTokens: 100000, mode: 'pre-step', cooldownMs: 0 })
  meter.tokens = 180000
  compaction.fail = new Error('summary is not smaller than the shadowed content')
  const returned = await root.waterfall('agent/pre-step', { agent, signal: undefined }, () => 'inner-reached')
  check('压缩失败仍继续 waterfall', returned === 'inner-reached', String(returned))
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 7. /ctx-compact 命令 ──────────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ maxContextTokens: 100000, mode: 'idle', cooldownMs: 0 })
  const definition = commands.definitions.get('ctx-compact')
  check('/ctx-compact 注册', Boolean(definition), [...commands.definitions.keys()].join(','))
  meter.tokens = 150000
  const outcome = await definition.handler({ agent, signal: new AbortController().signal })
  check('/ctx-compact 成功输出前后用量', outcome.kind === 'success' && outcome.text.includes('150,000') && outcome.text.includes('5,000'), outcome.text)
  check('/ctx-compact 调用了 compactNow', compaction.calls.some((c) => c.kind === 'compactNow'), JSON.stringify(compaction.calls.map((c) => c.kind)))

  compaction.fail = new Error('manual compaction requires an idle agent')
  const failed = await definition.handler({ agent, signal: new AbortController().signal })
  check('/ctx-compact 失败返回 error', failed.kind === 'error' && failed.text.includes('压缩失败'), failed.text)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 8. 卸载：监听器与命令都被移除 ─────────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ maxContextTokens: 100000, mode: 'idle', cooldownMs: 0 })
  meter.tokens = 180000
  await fiber.dispose()
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check('卸载后不再压缩', compaction.calls.length === 0, compaction.calls.length)
  check('卸载后 /ctx-compact 注销', !commands.definitions.has('ctx-compact'), [...commands.definitions.keys()].join(','))
  await root.fiber.dispose()
}

// ── 9. mode: 'off' 时不注册任何行为 ───────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ maxContextTokens: 100000, mode: 'off' })
  meter.tokens = 180000
  root.emit('agent/status', { agent, status: 'idle' })
  await tick()
  check("mode 'off' 不压缩", compaction.calls.length === 0, compaction.calls.length)
  check("mode 'off' 不注册命令", !commands.definitions.has('ctx-compact'), [...commands.definitions.keys()].join(','))
  await fiber.dispose()
  await root.fiber.dispose()
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[control] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[control] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exit(1)
}
