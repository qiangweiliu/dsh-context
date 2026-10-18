/**
 * control.js（preset 平面的「控制」半侧）的离线测试。
 *
 * 用真实 Cordis + 三个 mock 服务顶替宿主：
 *   - tokenMeter : 按 `meter.tokens` 返回测量快照
 *   - compaction : 记录 compactNow / compactIfNeeded 调用，可注入失败，
 *                  并可把 tokenMeter 的数值"压小"来模拟压缩生效
 *   - commands   : register() 返回 disposer
 *
 * 覆盖：插件形状 / 配置校验 / 上下文来源（会话覆盖 > 宿主默认 > 本行配置）/
 * idle 压缩 / 重试到低于上下文 / cooldown / notify / pre-step / 失败不打断轮次 /
 * /ctx-compact 成功与失败 / 状态回写 / 卸载清理 / mode off。
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
const state = await import(new URL('../state.js', import.meta.url).href)

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
    this.nodes = null
  }
  measure(session) {
    if (!session || typeof session !== 'object') throw new Error('measure() expects a session object')
    return Object.freeze({
      logRevision: 1,
      baseline: Object.freeze({ kind: 'estimated', tokens: this.tokens }),
      surfaceDeltaTokens: 0,
      totalTokens: this.tokens,
      surfaceTokens: this.tokens,
      nodes: this.nodes ?? Object.freeze([{ tokens: this.tokens }]),
    })
  }
}

class MockCompaction extends Service {
  constructor(ctx) {
    super(ctx, 'compaction')
    this.calls = []
    this.fail = null
    /** 由 mount() 注入：compactNow 生效后把它的 tokens 改成 shrinkTo（模拟压缩变小）。 */
    this.meter = null
    this.shrinkTo = null
    this.ifNeededResult = undefined
    this.result = Object.freeze({ shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 5000 })
  }
  async compactNow(agent, signal) {
    this.calls.push({ kind: 'compactNow', agent, signal })
    if (this.fail) throw this.fail
    if (this.shrinkTo !== null && this.meter) this.meter.tokens = this.shrinkTo
    return this.result
  }
  async compactIfNeeded(agent, trigger, signal) {
    this.calls.push({ kind: 'compactIfNeeded', agent, trigger, signal })
    if (this.fail) throw this.fail
    if (this.ifNeededResult !== undefined) return this.ifNeededResult
    if (this.shrinkTo !== null && this.meter) this.meter.tokens = this.shrinkTo
    return this.result
  }
  async compactRegion(start, end, agent, signal) {
    this.calls.push({ kind: 'compactRegion', start, end, agent, signal })
    if (this.fail) throw this.fail
    if (this.shrinkTo !== null && this.meter) this.meter.tokens = this.shrinkTo
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

/** 每个用例前清空共享状态，避免用例之间互相污染。 */
function resetState() {
  state.setDefaultBudget(undefined)
  state.setDefaultTriggerAt(1)
  for (const entry of state.listSessionBudgets()) state.clearSessionBudget(entry.sessionId)
  state.setControlActive(false)
  state.control.last = null
  state.control.at = null
}

/** 搭一个根上下文 + mock 服务。 */
async function mount(config) {
  resetState()
  const root = new Context()
  await root.plugin(MockTokenMeter)
  await root.plugin(MockCompaction)
  await root.plugin(MockCommands)
  const meter = root.get('tokenMeter')
  const compaction = root.get('compaction')
  compaction.meter = meter
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

// ── 2. idle 模式：超出上下文压缩一次并回写状态 ────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxAttempts: 2 })
  check('激活后 control.active = true', state.control.active === true && state.control.mode === 'idle', JSON.stringify(state.control))

  meter.tokens = 40000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('idle 未超出上下文不压缩', compaction.calls.length === 0, compaction.calls.length)

  meter.tokens = 180000
  compaction.shrinkTo = 50000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('idle 超出上下文先调 compactIfNeeded(pressure)', compaction.calls.length >= 1 && compaction.calls[0].kind === 'compactIfNeeded' && compaction.calls[0].trigger === 'pressure', JSON.stringify(compaction.calls.map((c) => `${c.kind}:${c.trigger}`)))
  check('超出上下文时按上下文触发（默认 0 = 跟随/兜底）', state.control.last?.before === 180000 && state.control.last?.after === 50000, JSON.stringify(state.control.last))
  check('成功压缩写入 success 日志（idle 触发）', state.listCompactionLog().some((entry) => entry.outcome === 'success' && entry.trigger === 'idle' && entry.before === 180000 && entry.after === 50000), JSON.stringify(state.listCompactionLog().slice(-2)))

  meter.tokens = 180000
  compaction.calls.length = 0
  root.emit('agent/status', { agent, status: 'running' })
  await tick()
  check('非 idle 状态不压缩', compaction.calls.length === 0, compaction.calls.length)
  await fiber.dispose()
  check('卸载后 control.active = false', state.control.active === false, String(state.control.active))
  await root.fiber.dispose()
}

// ── 2b. triggerAt：阈值参与自动压缩触发（默认 1 = 到上限才触发） ──────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000 })
  compaction.shrinkTo = 40000
  state.setDefaultTriggerAt(0.5)

  meter.tokens = 60000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('triggerAt=0.5 时 60% 用量触发预压缩', compaction.calls.length >= 1 && state.control.last?.before === 60000 && state.control.last?.after === 40000, JSON.stringify({ calls: compaction.calls.length, last: state.control.last }))

  state.setDefaultTriggerAt(1)
  compaction.calls.length = 0
  meter.tokens = 60000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('triggerAt=1 时 60% 用量不压缩', compaction.calls.length === 0, compaction.calls.length)

  meter.tokens = 120000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('triggerAt=1 时 120% 仍压缩', compaction.calls.length >= 1, compaction.calls.length)

  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 3. 上下文来源：会话覆盖 > 宿主默认 > 本行配置 ────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 200000 })
  compaction.shrinkTo = 10000

  meter.tokens = 150000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('本行 maxContextTokens 生效（150k < 200k 不压）', compaction.calls.length === 0, compaction.calls.length)

  state.setDefaultBudget(120000)
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('宿主默认上下文覆盖本行配置（150k > 120k 触发）', compaction.calls.length === 1, compaction.calls.length)

  compaction.calls.length = 0
  meter.tokens = 150000
  state.setSessionBudget('control-session', 300000)
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('会话级覆盖优先（300k 生效，不压）', compaction.calls.length === 0, compaction.calls.length)

  state.setSessionBudget('control-session', 50000)
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('会话级覆盖调低后触发（150k > 50k）', compaction.calls.length === 1, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 4. 压完仍超出上下文：按 maxAttempts 重试 ──────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000, maxAttempts: 2 })
  compaction.shrinkTo = 120000 // 压了但仍在上下文之上
  meter.tokens = 180000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('压完仍超出上下文时记录最终用量', compaction.calls.length >= 1 && state.control.last?.after === 120000, JSON.stringify({ calls: compaction.calls.map((c) => c.kind), last: state.control.last }))
  check('重试后状态记录最终用量', state.control.last?.after === 120000, JSON.stringify(state.control.last))
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 4b. compactRegion 范围：跳过 system、保留最近 keepTokens（确定性） ──
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000, keepTokens: 2000 })
  compaction.ifNeededResult = null // 强制走 compactRegion fallback
  compaction.shrinkTo = 50000
  meter.tokens = 120000
  meter.nodes = [
    { seq: 1, tokens: 2000 },
    { seq: 2, tokens: 2000 },
    { seq: 3, tokens: 2000 },
    { seq: 4, tokens: 2000 },
    { seq: 5, tokens: 2000 },
  ]
  agent.session = { id: 'control-session', eventAt: (seq) => ({ type: seq === 1 ? 'system/message' : seq === 5 ? 'user/message' : 'assistant/message' }) }
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  const region = compaction.calls.find((c) => c.kind === 'compactRegion')
  check('compactRegion 跳过 system 从消息节点起', Boolean(region) && region.start === 2, JSON.stringify(compaction.calls.map((c) => [c.kind, c.start, c.end])))
  check('compactRegion 保留最近 keepTokens（end=3）', Boolean(region) && region.end === 3, JSON.stringify(region))
  check('范围压缩后记录 before/after', state.control.last?.before === 120000 && state.control.last?.after === 50000, JSON.stringify(state.control.last))
  check('范围压缩不写 lastError', state.control.lastError === null, JSON.stringify(state.control.lastError))
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 4c. 没有足够可压历史时不调用 compactRegion ──
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000, keepTokens: 10000 })
  compaction.ifNeededResult = null
  meter.tokens = 120000
  meter.nodes = [
    { seq: 1, tokens: 1000 },
    { seq: 2, tokens: 2000 },
    { seq: 3, tokens: 2000 },
    { seq: 4, tokens: 2000 },
  ]
  agent.session = { id: 'control-session', eventAt: (seq) => ({ type: seq === 1 ? 'system/message' : 'user/message' }) }
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('可压历史不足时不调用 compactRegion', compaction.calls.every((c) => c.kind !== 'compactRegion'), JSON.stringify(compaction.calls.map((c) => c.kind)))
  check('可压历史不足时记录说明', typeof state.control.lastError === 'string' && state.control.lastError.length > 0, JSON.stringify(state.control.lastError))
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 5. cooldown 节流 ──────────────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'idle', cooldownMs: 60000, maxContextTokens: 100000 })
  compaction.shrinkTo = 50000
  meter.tokens = 180000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  meter.tokens = 180000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('cooldown 内只压缩一次', compaction.calls.length === 1, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 6. notify 模式只记录，不压缩 ──────────────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'notify', cooldownMs: 0, maxContextTokens: 100000 })
  meter.tokens = 180000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('notify 模式不调用压缩服务', compaction.calls.length === 0, compaction.calls.length)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 7. pre-step 模式：走 compactIfNeeded，且不吞掉 waterfall ───────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'pre-step', cooldownMs: 0, maxContextTokens: 100000 })
  meter.tokens = 180000
  const signal = new AbortController().signal
  const returned = await root.waterfall('agent/pre-step', { agent, signal }, () => 'inner-reached')
  check('pre-step 调用 compactIfNeeded(pressure)', compaction.calls.length === 1 && compaction.calls[0].kind === 'compactIfNeeded' && compaction.calls[0].trigger === 'pressure', JSON.stringify(compaction.calls.map((c) => `${c.kind}:${c.trigger}`)))
  check('pre-step 继续 waterfall 链', returned === 'inner-reached', String(returned))
  check('pre-step 也回写最近压缩状态', state.control.last?.before === 180000, JSON.stringify(state.control.last))

  meter.tokens = 5000
  const returned2 = await root.waterfall('agent/pre-step', { agent, signal }, () => 'inner-reached')
  check('未超出上下文时不压缩但继续链', compaction.calls.length === 1 && returned2 === 'inner-reached', `${compaction.calls.length}/${returned2}`)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 8. 压缩失败不影响轮次 ─────────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, agent } = await mount({ mode: 'pre-step', cooldownMs: 0, maxContextTokens: 100000 })
  meter.tokens = 180000
  compaction.fail = new Error('summary is not smaller than the shadowed content')
  const returned = await root.waterfall('agent/pre-step', { agent, signal: undefined }, () => 'inner-reached')
  check('压缩失败仍继续 waterfall', returned === 'inner-reached', String(returned))
  check('失败压缩写入 failure 日志（含原因）', state.listCompactionLog().some((entry) => entry.outcome === 'failure' && typeof entry.message === 'string' && entry.message.includes('smaller')), JSON.stringify(state.listCompactionLog().slice(-2)))
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 9. /ctx-compact 命令 ──────────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000 })
  const definition = commands.definitions.get('ctx-compact')
  check('/ctx-compact 注册', Boolean(definition), [...commands.definitions.keys()].join(','))
  compaction.shrinkTo = 50000
  meter.tokens = 150000
  const outcome = await definition.handler({ agent, signal: new AbortController().signal })
  check('/ctx-compact 成功输出前后用量', outcome.kind === 'success' && outcome.text.includes('150,000') && outcome.text.includes('50,000'), outcome.text)
  check('/ctx-compact 调用了 compactNow', compaction.calls.some((c) => c.kind === 'compactNow'), JSON.stringify(compaction.calls.map((c) => c.kind)))
  check('手动压缩写入 success 日志（manual 触发）', state.listCompactionLog().some((entry) => entry.outcome === 'success' && entry.trigger === 'manual' && entry.before === 150000 && entry.after === 50000), JSON.stringify(state.listCompactionLog().slice(-2)))

  const idle = await definition.handler({ agent, signal: new AbortController().signal })
  check('/ctx-compact 未超出上下文时提示无需压缩', idle.kind === 'success' && /无需压缩/.test(idle.text), idle.text)

  meter.tokens = 150000
  compaction.fail = new Error('manual compaction requires an idle agent')
  const failed = await definition.handler({ agent, signal: new AbortController().signal })
  check('/ctx-compact 失败返回 error', failed.kind === 'error' && failed.text.includes('压缩失败'), failed.text)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── 10. 卸载：监听器与命令都被移除 ────────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ mode: 'idle', cooldownMs: 0, maxContextTokens: 100000 })
  meter.tokens = 180000
  await fiber.dispose()
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check('卸载后不再压缩', compaction.calls.length === 0, compaction.calls.length)
  check('卸载后 /ctx-compact 注销', !commands.definitions.has('ctx-compact'), [...commands.definitions.keys()].join(','))
  await root.fiber.dispose()
}

// ── 11. mode: 'off' 时不激活 ──────────────────────────────────────────────
{
  const { root, fiber, meter, compaction, commands, agent } = await mount({ mode: 'off', maxContextTokens: 100000 })
  meter.tokens = 180000
  await root.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'inner-reached')
  check("mode 'off' 不压缩", compaction.calls.length === 0, compaction.calls.length)
  check("mode 'off' 不注册命令", !commands.definitions.has('ctx-compact'), [...commands.definitions.keys()].join(','))
  check("mode 'off' 不标记为激活", state.control.active === false, String(state.control.active))
  await fiber.dispose()
  await root.fiber.dispose()
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[control] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[control] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exit(1)
}
