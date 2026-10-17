/**
 * ctx-mon-and-con — DSH 上下文长度管理插件（node 侧最小可用骨架）
 *
 * 插件形态（Cordis 对象插件 / ESM 命名空间对象）：
 *   - name   : 插件在诊断与日志中的名字（Cordis 读取 module namespace 的 `name` 导出）
 *   - inject : 依赖的 Cordis 服务名数组；服务全部就绪后 Cordis 才调用 apply
 *   - Config : Standard Schema（Cordis 用 Config["~standard"].validate 同步校验配置，
 *              返回 { value } 或 { issues }；不支持 async 校验）
 *   - apply  : 插件主体，签名 (ctx, config)；返回的函数/生成器产出的 disposer 会在卸载时执行
 *
 * 设计取舍：本文件刻意 **不 import 任何 npm 包**。
 * 插件以 `link:`/本地目录方式装进 profile 的 node_modules 时，Node 会按真实路径解析
 * 裸导入，插件目录自己的 node_modules 往往不存在宿主依赖；只用 ctx 上的服务最稳。
 */

export const name = 'ctx-mon-and-con'

/** 与 control.js 共享的进程内状态（同一包内相对 import，不涉及 npm 依赖）。 */
import {
  budgetFor,
  control as controlState,
  getSessionBudget,
  listSessionBudgets,
  setDefaultBudget,
  setSessionBudget,
  clearSessionBudget,
} from './state.js'

/** 依赖的真实服务名（见 @deepseek-ai/dsh-commands / @deepseek-ai/dsh-token-meter）。 */
export const inject = ['commands', 'tokenMeter']

/** 与 package.json 的 version 保持一致（只用于状态接口的自述）。 */
const PLUGIN_VERSION = '0.4.0'

/** 浏览器半侧 client.js 拉的只读状态接口；两处路径必须一致。 */
const STATUS_PATH = '/api/ctx-mon-and-con/status'

/** 内存里最多保留多少条会话测量（进程内，重启即清空）。 */
const MAX_MEASUREMENTS = 10

const DEFAULT_CONFIG = {
  // 上下文窗口预算（token）。不同模型窗口不同，按需覆盖。
  contextWindowTokens: 128000,
  // 达到窗口的多少比例时标记“警告”。
  warnAt: 0.75,
  // 达到窗口的多少比例时标记“超限”（骨架里只影响 /ctx 的输出标记，不做拦截）。
  errorAt: 0.9,
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)

/**
 * 手写的 Standard Schema（零依赖）。
 * 想用 zod 时把本函数换成 `z.object({...})` 并把 zod 声明进 dependencies，
 * 但注意本地目录/link 安装时的裸导入解析问题。
 */
function validateConfig(input) {
  const issues = []
  const raw = input ?? {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { issues: [{ message: 'config must be an object' }] }
  }
  const config = { ...DEFAULT_CONFIG }
  for (const key of CONFIG_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ message: 'expected a finite number', path: [key] })
      continue
    }
    config[key] = value
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) issues.push({ message: 'unknown config key', path: [key] })
  }
  if (!Number.isInteger(config.contextWindowTokens) || config.contextWindowTokens <= 0) {
    issues.push({ message: 'expected a positive integer', path: ['contextWindowTokens'] })
  }
  for (const key of ['warnAt', 'errorAt']) {
    const value = config[key]
    if (!(value > 0 && value <= 1)) issues.push({ message: 'expected a number in (0, 1]', path: [key] })
  }
  if (!(config.warnAt < config.errorAt)) {
    issues.push({ message: 'warnAt must be smaller than errorAt', path: ['warnAt'] })
  }
  if (issues.length > 0) return { issues }
  return { value: Object.freeze(config) }
}

/** Cordis 的配置契约：同步 Standard Schema，version/vendor 只是标识。 */
export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'ctx-mon-and-con',
    validate: validateConfig,
  }),
})

const numberFormat = new Intl.NumberFormat('en-US')

function formatTokens(tokens) {
  return numberFormat.format(Math.max(0, Math.round(tokens)))
}

function formatRatio(value) {
  return `${(value * 100).toFixed(1)}%`
}

/** 统一的 /ctx 输出：一眼看到“用了多少 / 预算多少 / 是否该压缩”。 */
function renderUsage(measurement, budget, config) {
  const used = measurement.totalTokens
  const ratio = used / budget
  const status = ratio >= config.errorAt ? '超限（建议立刻压缩）' : ratio >= config.warnAt ? '警告（接近预算）' : 'ok'
  const lines = [
    `上下文长度：${formatTokens(used)} / ${formatTokens(budget)} tokens（${formatRatio(ratio)}，状态：${status}）`,
    `- 消息表面 surfaceTokens：${formatTokens(measurement.surfaceTokens)}`,
    `- 测量基线 baseline：${measurement.baseline?.kind ?? 'unknown'} ${formatTokens(measurement.baseline?.tokens ?? used)}`,
  ]
  if (Array.isArray(measurement.nodes)) lines.push(`- 计费节点 nodes：${measurement.nodes.length} 个`)
  lines.push('提示：/ctx <tokens> 临时改本会话预算，/ctx reset 恢复默认；控制半侧挂进 preset 后到点自动压缩。')
  return lines.join('\n')
}

/**
 * 注册 `/ctx`：显示当前会话的 token 用量；可选参数临时覆盖预算。
 * @param ctx Cordis 上下文（已注入 commands/tokenMeter）
 * @param config 经 Config 校验后的配置
 */
export function apply(ctx, config) {
  // 全局默认预算写进共享状态：控制半侧（control.js）在没有会话覆盖时用它。
  setDefaultBudget(config.contextWindowTokens)
  const inFlight = new Set()
  // 浏览器状态接口的数据源：按 session id 保留最近 MAX_MEASUREMENTS 条。
  const measurements = new Map()

  const sessionIdOf = (agent) => agent?.session?.id ?? agent?.sessionId
  const budgetOf = (agent) => budgetFor(sessionIdOf(agent), config.contextWindowTokens)

  /** 把一次测量压进内存表，供浏览器设置面板读取。 */
  const recordMeasurement = (agent, measurement, budget) => {
    const sessionId = sessionIdOf(agent) ?? 'unknown'
    const override = getSessionBudget(sessionId)
    const ratio = budget > 0 ? measurement.totalTokens / budget : 0
    const status = ratio >= config.errorAt ? 'error' : ratio >= config.warnAt ? 'warn' : 'ok'
    measurements.delete(sessionId)
    measurements.set(sessionId, {
      id: sessionId,
      totalTokens: measurement.totalTokens,
      surfaceTokens: measurement.surfaceTokens,
      budget,
      override: typeof override === 'number' ? override : null,
      ratio,
      status,
      at: new Date().toISOString(),
    })
    while (measurements.size > MAX_MEASUREMENTS) measurements.delete(measurements.keys().next().value)
  }

  /** @returns {{ kind: 'success', text: string } | { kind: 'error', text: string }} */
  const handler = (invocation) => {
    const { agent, rawInput, signal } = invocation
    if (signal?.aborted) return { kind: 'error', text: '已取消。' }
    // invocation.rawInput 是命令名之后的原始文本（/compact 也这样判断参数）。
    const argument = (rawInput ?? '').trim()
    const sessionId = sessionIdOf(agent)
    let budget = budgetOf(agent)
    let prefix = ''
    if (argument.length > 0) {
      if (argument === 'reset' || argument === 'clear') {
        const cleared = typeof sessionId === 'string' ? clearSessionBudget(sessionId) : false
        budget = budgetOf(agent)
        prefix = cleared
          ? `已清除本会话的临时预算，回到默认 ${formatTokens(budget)} tokens。\n`
          : `本会话没有临时预算，当前使用默认 ${formatTokens(budget)} tokens。\n`
      } else {
        if (!/^\d+$/.test(argument)) {
          return { kind: 'error', text: '用法：/ctx [tokens|reset]（例如 /ctx 200000 或 /ctx reset）' }
        }
        const next = Number(argument)
        if (!Number.isSafeInteger(next) || next <= 0) {
          return { kind: 'error', text: '预算必须是正整数 token 数。' }
        }
        if (typeof sessionId !== 'string' || !setSessionBudget(sessionId, next)) {
          return { kind: 'error', text: '当前会话没有可用的 id，无法设置预算。' }
        }
        budget = next
        prefix = `已把本会话预算改为 ${formatTokens(budget)} tokens（会话级覆盖；/ctx reset 可清除）。\n`
      }
    }
    // agent.session 是会话对象；ctx.tokenMeter.measure(session) 返回
    // { totalTokens, surfaceTokens, nodes, baseline, surfaceDeltaTokens, logRevision }（深度只读）。
    const session = agent?.session
    if (!session) return { kind: 'error', text: '当前没有可用会话，无法测量 token 用量。' }
    let measurement
    try {
      measurement = ctx.tokenMeter.measure(session)
    } catch (error) {
      return { kind: 'error', text: `测量失败：${error instanceof Error ? error.message : String(error)}` }
    }
    recordMeasurement(agent, measurement, budget)
    return { kind: 'success', text: prefix + renderUsage(measurement, budget, config) }
  }

  // 用 effect 注册：卸载插件时 Cordis 会逆序执行 disposer，先等 handler 收尾再注销命令。
  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled(inFlight)
    }
    yield ctx.commands.register({
      name: 'ctx',
      description: 'Show this session context token usage',
      input: { hint: '[tokens|reset]' },
      handler: (invocation) => {
        const result = handler(invocation)
        if (result instanceof Promise) {
          inFlight.add(result)
          const retire = () => inFlight.delete(result)
          result.then(retire, retire)
        }
        return result
      },
    })
  }, 'ctx-mon-and-con: /ctx command')

  // 控制半侧（control.js）挂在 agent preset 的 compaction 组里。它是否已生效不靠
  // 猜：control.js 激活时把状态写进 ./state.js，这里直接读；再顺带探测本 realm
  // 有没有 compaction 服务，作为「本组合能否控制」的辅证。
  const controlSnapshot = () => {
    let visible = false
    try {
      visible = typeof ctx.get === 'function' ? Boolean(ctx.get('compaction')) : false
    } catch {
      visible = false
    }
    return {
      active: controlState.active,
      mode: controlState.mode,
      lastCompactionAt: controlState.at,
      lastCompaction: controlState.last,
      compactionVisible: visible,
      presetRow: 'ctx-mon-and-con/control',
      hint: controlState.active
        ? 'control row is mounted and enforcing the budget'
        : 'mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group)',
    }
  }

  // 浏览器半侧（client.js）通过这个只读接口取预算与最近测量值。
  // 用 ctx.inject(['webServer']) 而不是写进 export const inject：
  // 无 Web server 的 profile（纯 CLI/headless）也能正常挂载本插件。
  const statusHandler = (request, response) => {
    if (request.method !== 'GET') {
      response.statusCode = 405
      response.setHeader('allow', 'GET')
      response.end()
      return
    }
    const body = JSON.stringify({
      plugin: 'ctx-mon-and-con',
      version: PLUGIN_VERSION,
      budget: {
        tokens: config.contextWindowTokens,
        warnAt: config.warnAt,
        errorAt: config.errorAt,
        source: 'default',
      },
      sessionBudgets: listSessionBudgets(),
      control: controlSnapshot(),
      measurements: [...measurements.values()].reverse(),
    })
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(body)
  }

  ctx.inject(['webServer'], (sub) => {
    const server = sub?.webServer
    if (!server || typeof server.register !== 'function') return
    const register = () => server.register({ kind: 'exact', path: STATUS_PATH, handler: statusHandler })
    if (typeof sub.effect === 'function') sub.effect(register, 'ctx-mon-and-con: status route')
    else register()
  })

  // 注意：本文件是宿主半侧，只读测量、不改会话历史。真正的「控制」在
  // control.js：它必须挂在 agent preset 的 compaction 组里，才能看到
  // ctx.compaction 并调用 compactNow / compactIfNeeded。
}
