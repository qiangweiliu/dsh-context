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
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  budgetFor,
  clearSessionToggles,
  clearSessionPromptText,
  getAutoMountControl,
  hydrateSessionToggles,
  hydrateCompactionLog,
  listCompactionLog,
  subscribeCompactionLog,
  setGlobalDisabledTools,
  setGlobalPromptOverrides,
  setGlobalExtraPrompts,
  setGlobalExtraPromptPlacements,
  getAppliedTools,
  getInventory,
  getSessionDisabledPrompts,
  getSessionDisabledTools,
  setSessionPromptEnabled,
  setAutoMountControl,
  setSessionPromptText,
  setSessionToolEnabled,
  snapshotSessionToggles,
  control as controlState,
  getSessionBudget,
  listSessionBudgets,
  setDefaultBudget,
  setDefaultTriggerAt,
  setDefaultKeepTokens,
  setDefaultTargetAt,
  setSessionBudget,
  clearSessionBudget,
} from './state.js'

import { foldSession, sessionDetail, summarizeFolds } from './metrics.js'

/** 依赖的真实服务名（见 @deepseek-ai/dsh-commands / @deepseek-ai/dsh-token-meter）。 */
export const inject = ['commands', 'tokenMeter']

/** 与 package.json 的 version 保持一致（只用于状态接口的自述）。 */
const PLUGIN_VERSION = '0.17.0'

/** 浏览器半侧 client.js 拉的只读状态接口；两处路径必须一致。 */
const STATUS_PATH = '/api/ctx-mon-and-con/status'

/** 内存里最多保留多少条会话测量（进程内，重启即清空）。 */
const MAX_MEASUREMENTS = 10

const DEFAULT_CONFIG = {
  // 上下文窗口上下文（token）。不同模型窗口不同，按需覆盖。
  contextWindowTokens: 128000,
  // 达到窗口的多少比例时标记“警告”（只影响标记/颜色，不触发压缩）。
  warnAt: 0.75,
  // 达到窗口的多少比例时标记“超限”（只影响标记/颜色，不做拦截）。
  errorAt: 0.9,
  // 自动压缩的触发比例（0–1；1 = 到上下限才触发，0.75 = 到警告阈值就预压缩）。
  triggerAt: 1,
  // 压缩目标比例（0–1；压缩到该比例以下就停止，默认 0.6 = 压到 60% 左右）。
  targetAt: 0.6,
  // 全局禁用的工具名（从每个请求的 tools 里摘掉，schema token 一并省掉）。
  disabledTools: [],
  // 全局提示词覆盖：section name -> 替换文本；空对象表示全部用原文。
  promptOverrides: {},
  // 全局新增提示词：用户命名 -> 文本；在 harness:identity 后插入新的 system section。
  extraPrompts: {},
  // 新增提示词的放置位置：name -> 'system' | 'user'；缺省 system。
  extraPromptPlacements: {},
  // 压缩时保留的最近 tokens（0 = 用插件预算的 25%）。
  keepTokens: 0,
  // 是否在启动时自动把控制行补挂进 agent preset（面板手动停用后置 false）。
  autoMountControl: true,
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
const NUMERIC_KEYS = ['contextWindowTokens', 'warnAt', 'errorAt', 'triggerAt', 'targetAt']

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
  const config = { ...DEFAULT_CONFIG, disabledTools: [], promptOverrides: {}, extraPrompts: {}, extraPromptPlacements: {}, autoMountControl: true, keepTokens: 0 }
  for (const key of NUMERIC_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ message: 'expected a finite number', path: [key] })
      continue
    }
    config[key] = value
  }
  if (raw.disabledTools !== undefined) {
    if (!Array.isArray(raw.disabledTools)) {
      issues.push({ message: 'expected an array of tool names', path: ['disabledTools'] })
    } else {
      const names = []
      for (const candidate of raw.disabledTools) {
        if (typeof candidate !== 'string' || candidate.length === 0) {
          issues.push({ message: 'expected a non-empty tool name', path: ['disabledTools'] })
          break
        }
        if (!names.includes(candidate)) names.push(candidate)
      }
      config.disabledTools = names
    }
  }
  if (raw.promptOverrides !== undefined) {
    if (typeof raw.promptOverrides !== 'object' || raw.promptOverrides === null || Array.isArray(raw.promptOverrides)) {
      issues.push({ message: 'expected an object of section name -> text', path: ['promptOverrides'] })
    } else {
      const overrides = {}
      for (const [name, text] of Object.entries(raw.promptOverrides)) {
        if (typeof name !== 'string' || name.length === 0) {
          issues.push({ message: 'expected non-empty section name', path: ['promptOverrides'] })
          break
        }
        if (typeof text !== 'string') {
          issues.push({ message: 'expected string text', path: ['promptOverrides', name] })
          break
        }
        overrides[name] = text
      }
      config.promptOverrides = overrides
    }
  }
  if (raw.extraPrompts !== undefined) {
    if (typeof raw.extraPrompts !== 'object' || raw.extraPrompts === null || Array.isArray(raw.extraPrompts)) {
      issues.push({ message: 'expected an object of prompt name -> text', path: ['extraPrompts'] })
    } else {
      const extras = {}
      for (const [name, text] of Object.entries(raw.extraPrompts)) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          issues.push({ message: 'expected non-empty prompt name', path: ['extraPrompts'] })
          break
        }
        if (typeof text !== 'string') {
          issues.push({ message: 'expected string text', path: ['extraPrompts', name] })
          break
        }
        extras[name] = text
      }
      config.extraPrompts = extras
    }
  }
  if (raw.extraPromptPlacements !== undefined) {
    if (typeof raw.extraPromptPlacements !== 'object' || raw.extraPromptPlacements === null || Array.isArray(raw.extraPromptPlacements)) {
      issues.push({ message: 'expected an object of prompt name -> system | user', path: ['extraPromptPlacements'] })
    } else {
      const placements = {}
      for (const [name, placement] of Object.entries(raw.extraPromptPlacements)) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          issues.push({ message: 'expected non-empty prompt name', path: ['extraPromptPlacements'] })
          break
        }
        if (placement !== 'system' && placement !== 'user') {
          issues.push({ message: "expected 'system' or 'user'", path: ['extraPromptPlacements', name] })
          break
        }
        if (placement === 'user') placements[name] = 'user'
      }
      config.extraPromptPlacements = placements
    }
  }
  if (raw.keepTokens !== undefined) {
    if (!Number.isInteger(raw.keepTokens) || raw.keepTokens < 0) issues.push({ message: 'expected a non-negative integer', path: ['keepTokens'] })
    else config.keepTokens = raw.keepTokens
  }
  if (raw.autoMountControl !== undefined) {
    if (typeof raw.autoMountControl !== 'boolean') issues.push({ message: 'expected a boolean', path: ['autoMountControl'] })
    else config.autoMountControl = raw.autoMountControl
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key) && key !== 'disabledTools' && key !== 'promptOverrides' && key !== 'extraPrompts' && key !== 'extraPromptPlacements' && key !== 'autoMountControl' && key !== 'keepTokens') issues.push({ message: 'unknown config key', path: [key] })
  }
  if (!Number.isInteger(config.contextWindowTokens) || config.contextWindowTokens <= 0) {
    issues.push({ message: 'expected a positive integer', path: ['contextWindowTokens'] })
  }
  for (const key of ['warnAt', 'errorAt', 'triggerAt']) {
    const value = config[key]
    if (!(value > 0 && value <= 1)) issues.push({ message: 'expected a number in (0, 1]', path: [key] })
  }
  if (!(config.targetAt > 0 && config.targetAt < 1)) {
    issues.push({ message: 'expected a number in (0, 1)', path: ['targetAt'] })
  }
  if (!(config.targetAt < config.triggerAt)) {
    issues.push({ message: 'targetAt must be smaller than triggerAt', path: ['targetAt'] })
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

const SOURCE_HINTS = {
  section(name) {
    if (name.startsWith('ctx-mon-and-con:extra:')) return 'ctx-mon-and-con (extra)'
    if (name.startsWith('harness:') || name.startsWith('deployment:')) return 'dsh-system-prompt'
    if (name.startsWith('tools:')) return 'dsh-tools'
    if (name.startsWith('tool:')) return 'dsh-tools'
    if (name.startsWith('ui:')) return 'dsh-client-ui-deliverables'
    if (name === 'plan:policy') return 'dsh-plan-mode'
    if (name === 'app:web-surface') return 'dsh-web-app'
    if (name === 'mcp-resource-servers') return 'dsh-mcp'
    return null
  },
}

let packagesRootCache
const packagesRoot = () => {
  if (packagesRootCache !== undefined) return packagesRootCache
  packagesRootCache = null
  const consider = (scopeDirectory) => {
    for (const marker of ['dsh-system-prompt', 'dsh-tools', 'dsh']) {
      if (existsSync(join(scopeDirectory, marker, 'package.json'))) {
        packagesRootCache = scopeDirectory
        return true
      }
    }
    return false
  }
  try {
    let dir = realpathSync(process.argv[1] ? process.argv[1] : process.cwd())
    if (existsSync(dir) && !statSync(dir).isDirectory()) dir = dirname(dir)
    for (let index = 0; index < 20; index += 1) {
      if (consider(join(dir, '@deepseek-ai'))) break
      if (consider(join(dir, 'node_modules', '@deepseek-ai'))) break
      if (consider(dir)) break
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {}
  return packagesRootCache
}

const sourceFileFor = (packageName) => {
  if (typeof packageName !== 'string' || packageName.length === 0) return null
  const root = packagesRoot()
  if (!root) return null
  const file = join(root, packageName, 'lib', 'index.js')
  return existsSync(file) ? file : null
}

const sourcesFor = (inventory) => {
  const sections = {}
  for (const section of inventory && Array.isArray(inventory.sections) ? inventory.sections : []) {
    sections[section.name] = section.name.startsWith('ctx-mon-and-con:extra:')
      ? 'ctx-mon-and-con/control.js'
      : sourceFileFor(SOURCE_HINTS.section(section.name))
  }
  return { sections }
}

const numberFormat = new Intl.NumberFormat('en-US')

function formatTokens(tokens) {
  return numberFormat.format(Math.max(0, Math.round(tokens)))
}

function formatRatio(value) {
  return `${(value * 100).toFixed(1)}%`
}

/** 统一的 /ctx 输出：一眼看到“用了多少 / 上下文多少 / 是否该压缩”。 */
function renderUsage(measurement, budget, config) {
  const used = measurement.totalTokens
  const ratio = used / budget
  const status = ratio >= config.errorAt ? '超限（建议立刻压缩）' : ratio >= config.warnAt ? '警告（接近上下文）' : 'ok'
  const lines = [
    `上下文长度：${formatTokens(used)} / ${formatTokens(budget)} tokens（${formatRatio(ratio)}，状态：${status}）`,
    `- 消息表面 surfaceTokens：${formatTokens(measurement.surfaceTokens)}`,
    `- 测量基线 baseline：${measurement.baseline?.kind ?? 'unknown'} ${formatTokens(measurement.baseline?.tokens ?? used)}`,
  ]
  if (Array.isArray(measurement.nodes)) lines.push(`- 计费节点 nodes：${measurement.nodes.length} 个`)
  lines.push('提示：/ctx <tokens> 临时改本会话上下文，/ctx reset 恢复默认；控制半侧挂进 preset 后到点自动压缩。')
  return lines.join('\n')
}

/**
 * 注册 `/ctx`：显示当前会话的 token 用量；可选参数临时覆盖上下文。
 * @param ctx Cordis 上下文（已注入 commands/tokenMeter）
 * @param config 经 Config 校验后的配置
 */
export function apply(ctx, config) {
  // 全局默认上下文写进共享状态：控制半侧（control.js）在没有会话覆盖时用它。
  setDefaultBudget(config.contextWindowTokens)
  setDefaultTriggerAt(config.triggerAt)
  setDefaultTargetAt(config.targetAt)
  setDefaultKeepTokens(config.keepTokens)
  setGlobalPromptOverrides(config.promptOverrides)
  setGlobalExtraPrompts(config.extraPrompts)
  setGlobalExtraPromptPlacements(config.extraPromptPlacements)
  setGlobalDisabledTools(config.disabledTools)

  // 会话级开关持久化：~/.dsh/ctx-mon-and-con/session-toggles.json（按 sessionId 区分，跨 profile 共享）。
  const SESSION_TOGGLES_PATH = join(homedir(), '.dsh', 'ctx-mon-and-con', 'session-toggles.json')
  const saveSessionToggles = () => {
    try {
      backupFile(SESSION_TOGGLES_PATH, 'session-toggles')
      mkdirSync(dirname(SESSION_TOGGLES_PATH), { recursive: true })
      writeFileSync(SESSION_TOGGLES_PATH, JSON.stringify(snapshotSessionToggles(), null, 2) + '\n', 'utf8')
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('ctx-mon-and-con: could not save session toggles: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const loadSessionToggles = () => {
    try {
      if (!existsSync(SESSION_TOGGLES_PATH)) return
      hydrateSessionToggles(JSON.parse(readFileSync(SESSION_TOGGLES_PATH, 'utf8')))
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('ctx-mon-and-con: could not load session toggles: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  loadSessionToggles()

  // 压缩记录持久化：~/.dsh/ctx-mon-and-con/compaction-log.jsonl（JSONL，内存最多 200 条）。
  const COMPACTION_LOG_PATH = join(homedir(), '.dsh', 'ctx-mon-and-con', 'compaction-log.jsonl')
  const COMPACTION_LOG_MAX_BYTES = 512 * 1024
  const COMPACTION_LOG_KEEP_LINES = 400
  const loadCompactionLog = () => {
    try {
      if (!existsSync(COMPACTION_LOG_PATH)) return
      const lines = readFileSync(COMPACTION_LOG_PATH, 'utf8').split('\n').filter((line) => line.trim().length > 0)
      const entries = []
      for (const line of lines.slice(-200)) {
        try {
          entries.push(JSON.parse(line))
        } catch {}
      }
      hydrateCompactionLog(entries)
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('ctx-mon-and-con: could not load compaction log: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  loadCompactionLog()
  ctx.effect(() => {
    const unsubscribe = subscribeCompactionLog((entry) => {
      try {
        mkdirSync(dirname(COMPACTION_LOG_PATH), { recursive: true })
        appendFileSync(COMPACTION_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8')
        // 体积过大时只保留最近 N 行，避免长期运行无限增长。
        if (statSync(COMPACTION_LOG_PATH).size > COMPACTION_LOG_MAX_BYTES) {
          const lines = readFileSync(COMPACTION_LOG_PATH, 'utf8').split('\n').filter((line) => line.trim().length > 0).slice(-COMPACTION_LOG_KEEP_LINES)
          writeFileSync(COMPACTION_LOG_PATH, lines.join('\n') + '\n', 'utf8')
        }
      } catch (error) {
        const logger = ctx.logger
        if (typeof logger?.warn === 'function') logger.warn('ctx-mon-and-con: could not append compaction log: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
    return () => unsubscribe()
  }, 'ctx-mon-and-con: compaction log persistence')
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
    const breakdown = breakdownOf(agent?.session)
    measurements.set(sessionId, {
      id: sessionId,
      totalTokens: measurement.totalTokens,
      surfaceTokens: measurement.surfaceTokens,
      budget,
      override: typeof override === 'number' ? override : null,
      breakdown,
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
          ? `已清除本会话的临时上下文，回到默认 ${formatTokens(budget)} tokens。\n`
          : `本会话没有临时上下文，当前使用默认 ${formatTokens(budget)} tokens。\n`
      } else {
        if (!/^\d+$/.test(argument)) {
          return { kind: 'error', text: '用法：/ctx [tokens|reset]（例如 /ctx 200000 或 /ctx reset）' }
        }
        const next = Number(argument)
        if (!Number.isSafeInteger(next) || next <= 0) {
          return { kind: 'error', text: '上下文必须是正整数 token 数。' }
        }
        if (typeof sessionId !== 'string' || !setSessionBudget(sessionId, next)) {
          return { kind: 'error', text: '当前会话没有可用的 id，无法设置上下文。' }
        }
        budget = next
        prefix = `已把本会话上下文改为 ${formatTokens(budget)} tokens（会话级覆盖；/ctx reset 可清除）。\n`
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
      lastError: controlState.lastError,
      lastCompaction: controlState.last,
      compacting: controlState.compacting,
      log: listCompactionLog().slice(-50),
      compactionVisible: visible,
      presetRow: 'ctx-mon-and-con/control',
      ...presetMountState(),
      hint: controlState.active
        ? 'control row is mounted and enforcing the budget'
        : 'mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group)',
    }
  }

  // 会话查找与预设挂载：给「实时占用」指示器与「启用自动压缩」按钮用。
  let sessionProjections = null
  ctx.inject(['sessionProjections'], (sub) => {
    sessionProjections = sub?.sessionProjections ?? null
    if (typeof sub.effect === 'function') sub.effect(() => () => { sessionProjections = null }, 'ctx-mon-and-con: projections presence')
  })

  /**
   * 官方 contextBreakdown 只给 system/tools/message 三桶；这里再把 message 拆成
   * 「本轮用户消息」与「上文」，得到四桶（skill 内容并进系统提示词/工具定义，不单列）。
   * @returns {{ systemTokens: number, toolsTokens: number, historyTokens: number, userTokens: number, totalTokens: number } | null}
   */
  const breakdownOf = (session) => {
    if (!session) return null
    let measurement
    try {
      measurement = ctx.tokenMeter.measure(session)
    } catch {
      return null
    }
    const nodes = Array.isArray(measurement?.nodes) ? measurement.nodes : []
    let systemTokens = 0
    let toolsTokens = 0
    let messageTokens = null
    try {
      const snapshot = sessionProjections && typeof sessionProjections.snapshot === 'function'
        ? sessionProjections.snapshot(session, ['contextBreakdown'])
        : undefined
      const value = snapshot && snapshot.values ? snapshot.values.contextBreakdown : undefined
      if (value && typeof value.systemTokens === 'number') {
        systemTokens = value.systemTokens
        toolsTokens = value.toolsTokens ?? 0
        messageTokens = value.messageTokens
      }
    } catch {}
    const heuristicOf = (node) => (typeof node?.heuristicTokens === 'number' ? node.heuristicTokens : Number(node?.tokens) || 0)
    if (messageTokens === null) {
      // 没有投影时的兜底：第一个节点视为系统提示词，其余算对话消息。
      systemTokens = nodes.length > 0 ? heuristicOf(nodes[0]) : 0
      messageTokens = nodes.slice(1).reduce((sum, node) => sum + heuristicOf(node), 0)
    }
    // 「本轮用户对话」= 最近一次 assistant 回复之前那一轮的用户输入（外加尚未回复的待处理输入）。
    // 实现上取「倒数第二条 assistant 消息之后的全部 user/message 节点」，不依赖 turn 字段，
    // 回放、compaction、steering 之后仍然成立；其余可见消息算「上文」。
    let userTokens = 0
    let lastAssistantIndex = -1
    let prevAssistantIndex = -1
    const events = []
    for (const node of nodes) {
      let event
      try {
        event = typeof session.eventAt === 'function' ? session.eventAt(node.seq) : undefined
      } catch {}
      events.push({ node, event })
      if (event && event.type === 'assistant/message') {
        prevAssistantIndex = lastAssistantIndex
        lastAssistantIndex = events.length - 1
      }
    }
    const from = prevAssistantIndex + 1
    for (let index = from; index < events.length; index += 1) {
      const entry = events[index]
      if (entry.event && entry.event.type === 'user/message') userTokens += heuristicOf(entry.node)
    }
    userTokens = Math.min(Math.max(0, userTokens), Math.max(0, messageTokens))
    const historyTokens = Math.max(0, messageTokens - userTokens)
    const totalTokens = systemTokens + toolsTokens + historyTokens + userTokens
    return { systemTokens, toolsTokens, historyTokens, userTokens, totalTokens }
  }

  let sessions = null
  ctx.inject(['sessions'], (sub) => {
    sessions = sub?.sessions ?? null
    if (typeof sub.effect === 'function') sub.effect(() => () => { sessions = null }, 'ctx-mon-and-con: sessions presence')
  })

  const requestUrl = (request) => new URL(request.url ?? '/', 'http://localhost')

  /** GET 实时占用：按 sessionId 找到 Session，用 tokenMeter 现场测量。 */
  const liveHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const requested = requestUrl(request).searchParams.get('sessionId') ?? ''
    let sessionId = requested
    let session
    if (sessions && typeof sessions.get === 'function') {
      if (requested) {
        session = sessions.get(requested)
      } else if (typeof sessions.list === 'function') {
        const all = sessions.list()
        const latest = Array.isArray(all) && all.length > 0 ? all[all.length - 1] : undefined
        if (latest) {
          session = latest
          sessionId = latest.id
        }
      }
    }
    if (!session) return send(404, { ok: false, error: requested ? 'unknown session' : 'no session yet' })
    let used = null
    try {
      const measurement = ctx.tokenMeter.measure(session)
      used = typeof measurement?.totalTokens === 'number' ? measurement.totalTokens : null
    } catch {}
    const budget = budgetFor(sessionId, config.contextWindowTokens)
    return send(200, {
      ok: true,
      sessionId,
      used,
      budget,
      compacting: controlState.compacting,
      breakdown: breakdownOf(session),
      warnAt: config.warnAt,
      errorAt: config.errorAt,
      triggerAt: config.triggerAt,
      targetAt: config.targetAt,
      keepTokens: config.keepTokens,
      ratio: typeof used === 'number' && budget > 0 ? used / budget : null,
    })
  }

  /** 常见 preset id；desktop app 等环境可能用其他 id。 */
  const PRESET_IDS = ['preset-standard', 'preset-desktop', 'desktop', 'agent-preset', 'default', 'preset-default']

  /** 列出可编辑的 preset 候选：优先已知 id，其次任何带 plugins 配置的行。 */
  const listPresetEntries = () => {
    const editor = configEditor
    if (!editor || typeof editor.entries !== 'function') return []
    return editor.entries().filter((entry) => entry && Array.isArray(entry.options?.config?.plugins))
  }

  /** 找到 agent preset 行；desktop profile 用非标准 id 时也能命中。 */
  const findPresetEntry = () => {
    const entries = listPresetEntries()
    if (entries.length === 0) return null
    for (const id of PRESET_IDS) {
      const hit = entries.find((entry) => entry.options?.id === id)
      if (hit) return hit
    }
    return entries.find((entry) => typeof entry.options?.id === 'string' && entry.options.id.includes('preset')) ?? entries[0]
  }

  const CONTROL_ROW_ID = 'ctx-mon-and-con-control'
  const CONTROL_ROW = Object.freeze({ id: CONTROL_ROW_ID, name: 'ctx-mon-and-con/control', config: { mode: 'idle' } })

  /** 读取 preset 里压缩组是否已经挂了我们的控制行。 */
  const presetMountState = () => {
    const entry = findPresetEntry()
    if (!entry) return { presetMountable: false, presetMounted: false }
    const plugins = Array.isArray(entry.options?.config?.plugins) ? entry.options.config.plugins : []
    const group = plugins.find((row) => row && row.id === 'compaction' && Array.isArray(row.config))
    return {
      presetMountable: true,
      presetMounted: Boolean(group && group.config.some((row) => row && row.id === CONTROL_ROW_ID)),
    }
  }

  /** 只复制路径上的对象/数组，保留 !!js 解析出来的函数与其他行原样。 */
  const mutatePreset = (current, enable) => {
    const base = current && typeof current === 'object' ? current : {}
    const plugins = Array.isArray(base.plugins) ? base.plugins.slice() : []
    let index = plugins.findIndex((row) => row && row.id === 'compaction')
    if (index < 0) {
      if (!enable) return { ...base, plugins }
      plugins.push({
        id: 'compaction',
        name: 'cordis:group',
        group: true,
        isolate: { compaction: true, toolResultPruner: true },
        config: [],
      })
      index = plugins.length - 1
    }
    const group = plugins[index] && typeof plugins[index] === 'object' ? plugins[index] : {}
    const children = Array.isArray(group.config) ? group.config.filter((row) => !(row && row.id === CONTROL_ROW_ID)) : []
    if (enable) children.push(CONTROL_ROW)
    plugins[index] = { ...group, config: children }
    return { ...base, plugins }
  }

  /** POST /config/preset {enable:boolean}：把控制行写进 preset-standard 或移除。 */
  let presetQueue = Promise.resolve()
  const enqueuePreset = (task) => {
    presetQueue = presetQueue.then(task).catch((error) => {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn(`ctx-mon-and-con: preset task failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 启动时检测：preset 里没有控制行且未被手动停用 → 自动补挂。 */
  function autoMountControl() {
    if (!getAutoMountControl()) return
    const editor = configEditor
    const entry = findPresetEntry()
    if (!editor || typeof editor.edit !== 'function' || !entry) return
    if (presetMountState().presetMounted) return
    void editor
      .edit(entry, (current) => mutatePreset(current, true))
      .catch((error) => {
        const logger = ctx.logger
        if (typeof logger?.warn === 'function') logger.warn(`ctx-mon-and-con: auto-mount failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  const presetHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const editor = configEditor
    const entry = findPresetEntry()
    if (!editor || typeof editor.edit !== 'function' || !entry) {
      return send(501, { ok: false, error: 'agent preset is not editable in this profile' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      if (typeof input?.enable !== 'boolean') return send(400, { ok: false, error: 'enable must be a boolean' })
      send(202, { ok: true, accepted: { enable: input.enable } })
      if (input.enable) {
        setAutoMountControl(true)
        saveSessionToggles()
        enqueuePreset(async () => {
          const ed = configEditor
          const target = findPresetEntry()
          if (ed && typeof ed.edit === 'function' && target) await ed.edit(target, (current) => mutatePreset(current, true))
        })
      } else {
        setAutoMountControl(false)
        saveSessionToggles()
        enqueuePreset(async () => {
          const ed = configEditor
          const target = findPresetEntry()
          if (ed && typeof ed.edit === 'function' && target) await ed.edit(target, (current) => mutatePreset(current, false))
        })
      }
    })
  }

  // 浏览器半侧（client.js）通过这个只读接口取上下文与最近测量值。
  // 用 ctx.inject(['webServer']) 而不是写进 export const inject：
  // 无 Web server 的 profile（纯 CLI/headless）也能正常挂载本插件。
  let sessionQuery = null
  ctx.inject(['sessionQuery'], (sub) => {
    sessionQuery = sub?.sessionQuery ?? null
    if (typeof sub.effect === 'function') sub.effect(() => () => { sessionQuery = null }, 'ctx-mon-and-con: sessionQuery presence')
  })

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        if (typeof timer?.unref === 'function') timer.unref()
      }),
    ])

  const mapLimit = async (items, limit, worker) => {
    const output = new Array(items.length)
    let cursor = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        output[index] = await worker(items[index], index)
      }
    })
    await Promise.all(runners)
    return output
  }

  // 会话日志折叠很便宜但文件读取不便宜；按 sessionId 做短 TTL 缓存，页面切 tab/刷新不会反复读全量。
  const foldCache = new Map()
  const observeFold = async (sessionId, header, ttlMs = 20000) => {
    const cached = foldCache.get(sessionId)
    if (cached && Date.now() - cached.at < ttlMs) return cached.fold
    if (!sessionQuery || typeof sessionQuery.observeSession !== 'function') throw new Error('sessionQuery.observeSession unavailable')
    const observation = await withTimeout(sessionQuery.observeSession(sessionId, { projectionMode: 'none' }), 4000, 'observeSession')
    try {
      const fold = foldSession(observation.header ?? header, observation.events ?? [])
      foldCache.set(sessionId, { at: Date.now(), fold })
      return fold
    } finally {
      const dispose = typeof observation[Symbol.dispose] === 'function' ? observation[Symbol.dispose] : null
      if (dispose) dispose.call(observation)
    }
  }

  const parseRange = (value) => {
    if (value === 'today') return 1
    if (value === '30d') return 30
    if (value === 'all') return 3650
    return 7
  }

  /** GET /status/analytics?range=7d|30d|all|today&limit=40 —— 近 N 个会话的聚合。 */
  const analyticsHandler = async (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    if (!sessionQuery || typeof sessionQuery.listSessions !== 'function') {
      return send(503, { ok: false, error: 'sessionQuery unavailable in this host' })
    }
    const url = requestUrl(request)
    const days = parseRange(url.searchParams.get('range'))
    const limit = Math.min(80, Math.max(1, Number(url.searchParams.get('limit')) || 40))
    try {
      const records = await withTimeout(sessionQuery.listSessions(), 8000, 'listSessions')
      const list = Array.isArray(records) ? records : []
      const picked = list.slice(0, limit)
      const warnings = []
      const folds = await mapLimit(picked, 4, async (record) => {
        try {
          return await observeFold(record.header.id, record.header, record.live ? 3000 : 20000)
        } catch (error) {
          warnings.push(`${record.header.id}: ${error instanceof Error ? error.message : String(error)}`)
          return null
        }
      })
      const summary = summarizeFolds(folds.filter(Boolean), { days })
      return send(200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        range: url.searchParams.get('range') ?? '7d',
        coverage: { total: list.length, scanned: picked.length, withData: folds.filter(Boolean).length, limit },
        warnings: warnings.slice(0, 5),
        ...summary,
      })
    } catch (error) {
      return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** GET /status/session-detail?sessionId=... —— 当前会话的请求序列 + 事件。 */
  const sessionDetailHandler = async (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    if (!sessionQuery || typeof sessionQuery.observeSession !== 'function') {
      return send(503, { ok: false, error: 'sessionQuery unavailable in this host' })
    }
    const url = requestUrl(request)
    const sessionId = url.searchParams.get('sessionId') || latestSession()?.id
    if (!sessionId) return send(404, { ok: false, error: 'no session yet' })
    try {
      const fold = await observeFold(sessionId, null, 5000)
      return send(200, { ok: true, ...sessionDetail(fold) })
    } catch (error) {
      return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }


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
        triggerAt: config.triggerAt,
        targetAt: config.targetAt,
        keepTokens: config.keepTokens,
        source: 'default',
      },
      sessionBudgets: listSessionBudgets(),
      control: controlSnapshot(),
      configEditable: Boolean(configEditor && typeof configEditor.edit === 'function'),
      measurements: [...measurements.values()].reverse(),
    })
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(body)
  }

  // 所有写操作前自动备份（profile patch 与 session-toggles.json），保留最近 30 份。
  const BACKUP_DIR = join(homedir(), '.dsh', 'ctx-mon-and-con', 'backups')
  const backupFile = (filePath, label) => {
    try {
      if (!filePath || !existsSync(filePath)) return
      mkdirSync(BACKUP_DIR, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(filePath, join(BACKUP_DIR, `${label}.${stamp}.bak`))
      const names = readdirSync(BACKUP_DIR)
        .filter((name) => name.startsWith(label + '.'))
        .sort()
      while (names.length > 30) {
        const stale = names.shift()
        try {
          unlinkSync(join(BACKUP_DIR, stale))
        } catch {}
      }
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('ctx-mon-and-con: backup failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  // 可写配置：宿主平面有 configEditor 服务时（Web/Desktop profile 都有），
  // 面板可以把上下文/阈值写回 profile 的 patch 层，写完后 Loader 会按新配置重挂本插件。
  let configEditor = null
  ctx.inject(['configEditor'], (sub) => {
    configEditor = sub?.configEditor ?? null
    try {
      if (configEditor && typeof configEditor.edit === 'function' && !configEditor.__ctxBackedUp) {
        const originalEdit = configEditor.edit.bind(configEditor)
        configEditor.edit = (...args) => {
          try {
            const patchPath = typeof configEditor.documentPath === 'string' ? configEditor.documentPath : null
            backupFile(patchPath, 'cordis.patch')
          } catch {}
          return originalEdit(...args)
        }
        configEditor.__ctxBackedUp = true
      }
    } catch {}
    setTimeout(() => {
      try {
        autoMountControl()
      } catch {}
    }, 1200)
    if (typeof sub.effect === 'function') sub.effect(() => () => { configEditor = null }, 'ctx-mon-and-con: config editor presence')
  })

  /** 校验来自浏览器面板的配置补丁；不合法返回 null。 */
  const parseConfigPatch = (raw) => {
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      return null
    }
    if (typeof input !== 'object' || input === null) return null
    const patch = {}
    if (input.contextWindowTokens !== undefined) {
      if (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens <= 0) return null
      patch.contextWindowTokens = input.contextWindowTokens
    }
    const ratios = {}
    for (const key of ['warnAt', 'errorAt', 'triggerAt']) {
      if (input[key] === undefined) continue
      if (typeof input[key] !== 'number' || !(input[key] > 0 && input[key] <= 1)) return null
      ratios[key] = input[key]
    }
    if (input.keepTokens !== undefined) {
      if (!Number.isInteger(input.keepTokens) || input.keepTokens < 0) return null
      patch.keepTokens = input.keepTokens
    }
    if (input.targetAt !== undefined) {
      if (typeof input.targetAt !== 'number' || !(input.targetAt > 0 && input.targetAt < 1)) return null
      ratios.targetAt = input.targetAt
    }
    const warn = ratios.warnAt ?? config.warnAt
    const error = ratios.errorAt ?? config.errorAt
    const trigger = ratios.triggerAt ?? config.triggerAt
    const target = ratios.targetAt ?? config.targetAt
    if (!(warn < error)) return null
    if (!(target < trigger)) return null
    return { ...patch, ...ratios }
  }

  let configWrite = null

  /** POST 配置：先 202 应答，再在后台让 configEditor 落盘并重挂（重挂会销毁本路由）。 */
  const configHandler = (request, response) => {
    if (request.method !== 'POST') {
      response.statusCode = 405
      response.setHeader('allow', 'POST')
      response.end()
      return
    }
    const editor = configEditor
    if (!editor || typeof editor.edit !== 'function' || typeof editor.entries !== 'function') {
      response.statusCode = 501
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ ok: false, error: 'config editor unavailable in this profile' }))
      return
    }
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1024) {
        response.statusCode = 413
        response.end()
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const patch = parseConfigPatch(Buffer.concat(chunks).toString('utf8'))
      if (patch === null) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ ok: false, error: 'invalid config patch' }))
        return
      }
      const entry = editor.entries().find((candidate) => candidate?.options?.id === 'ctx-mon-and-con')
      if (!entry) {
        response.statusCode = 409
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ ok: false, error: 'plugin entry is not editable in the active profile' }))
        return
      }
      response.statusCode = 202
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ ok: true, accepted: patch }))
      // 落盘会触发重挂，本插件的旧实例（包括这条路由）随即被销毁。
      void editor
        .edit(entry, (current) => ({ ...(current ?? {}), ...patch }))
        .catch((error) => {
          const logger = ctx.logger
          if (typeof logger?.warn === 'function') logger.warn(`ctx-mon-and-con: config write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    })
  }

  // 全局工具黑名单：从 profile 配置读取，限制所有 agent 的可见工具集。
  ctx.inject(['tools'], (sub) => {
    const tools = sub?.tools
    if (!tools || typeof tools.restrict !== 'function') return
    const install = () => {
      const deny = Array.isArray(config.disabledTools) ? [...config.disabledTools] : []
      return deny.length > 0 ? tools.restrict({ deny }) : () => {}
    }
    if (typeof sub.effect === 'function') {
      let dispose
      sub.effect(
        () => {
          dispose = install()
          return () => {
            try {
              dispose?.()
            } catch {}
          }
        },
        'ctx-mon-and-con: global tool restriction',
      )
    } else install()
  })

  /** 最近一个会话（与 /live 同一口径）。 */
  const latestSession = () => {
    if (!sessions || typeof sessions.list !== 'function') return undefined
    const all = sessions.list()
    return Array.isArray(all) && all.length > 0 ? all[all.length - 1] : undefined
  }

  /** GET 当前会话的工具/提示词清单与开关状态。 */
  const inventoryHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const requested = requestUrl(request).searchParams.get('sessionId') ?? ''
    const session = requested && sessions && typeof sessions.get === 'function' ? sessions.get(requested) : latestSession()
    const sessionId = requested || session?.id
    return send(200, {
      ok: true,
      sessionId,
      inventory: sessionId ? (() => {
        const found = getInventory(sessionId)
        return found ? { ...found, sources: sourcesFor(found) } : null
      })() : null,
      disabledSessionTools: sessionId ? getSessionDisabledTools(sessionId) : [],
      disabledSessionPrompts: sessionId ? getSessionDisabledPrompts(sessionId) : [],
      disabledTools: Array.isArray(config.disabledTools) ? config.disabledTools : [],
      promptOverrides: config.promptOverrides || {},
      extraPrompts: runtimeExtraPrompts,
      extraPromptPlacements: runtimeExtraPromptPlacements,
      applied: sessionId ? getAppliedTools(sessionId) : null,
    })
  }

  /** POST /inventory/toggle {kind, name, layer, enabled}。 */
  const inventoryToggleHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const kind = input?.kind
      const layer = input?.layer
      const name = input?.name
      const enabled = input?.enabled
      if (!['tool', 'prompt'].includes(kind) || !['session', 'global'].includes(layer) || typeof name !== 'string' || name.length === 0 || typeof enabled !== 'boolean') {
        return send(400, { ok: false, error: 'kind/layer/name/enabled are invalid' })
      }
      if (layer === 'global' && kind !== 'tool') return send(400, { ok: false, error: 'prompts only support the session layer' })
      const session = latestSession()
      if (layer === 'session') {
        const requestedSession = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
        const targetId = requestedSession || session?.id
        if (!targetId) return send(409, { ok: false, error: 'no session yet' })
        if (kind === 'tool') setSessionToolEnabled(targetId, name, enabled)
        else setSessionPromptEnabled(targetId, name, enabled)
        saveSessionToggles()
        return send(202, { ok: true, layer, kind, name, enabled, note: 'applies to the next request' })
      }
      const editor = configEditor
      const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'ctx-mon-and-con') : undefined
      if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
      const current = Array.isArray(config.disabledTools) ? [...config.disabledTools] : []
      const next = enabled ? current.filter((item) => item !== name) : current.includes(name) ? current : [...current, name]
      send(202, { ok: true, layer, kind, name, enabled, note: 'writes profile config; plugin reloads' })
      void editor
        .edit(entry, (value) => ({ ...(value ?? {}), disabledTools: next }))
        .then(() => {
          configWrite = { at: new Date().toISOString(), disabledTools: next }
        })
        .catch((error) => {
          configWrite = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
        const logger = ctx.logger
        if (typeof logger?.warn === 'function') logger.warn(`ctx-mon-and-con: inventory write failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }

  /** POST /inventory/reset {layer:'session'}：清空当前会话的全部开关。 */
  const inventoryResetHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const layer = input?.layer
      if (!['session', 'global', 'all'].includes(layer)) return send(400, { ok: false, error: 'layer must be session, global or all' })
      if (layer === 'session' || layer === 'all') {
        const requestedSession = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
        const targetId = requestedSession || latestSession()?.id
        if (!targetId) return send(409, { ok: false, error: 'no session yet' })
        clearSessionToggles(targetId)
        saveSessionToggles()
      }
      if (layer === 'global' || layer === 'all') {
        const editor = configEditor
        const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'ctx-mon-and-con') : undefined
        if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
        runtimeExtraPrompts = {}
        runtimeExtraPromptPlacements = {}
        setGlobalExtraPrompts({})
        setGlobalExtraPromptPlacements({})
        send(202, { ok: true, layer })
        void editor
          .edit(entry, (value) => ({ ...(value ?? {}), disabledTools: [], promptOverrides: {}, extraPrompts: {}, extraPromptPlacements: {} }))
          .catch((error) => {
            promptWrite = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
          })
        return
      }
      return send(202, { ok: true, layer })
    })
  }

  let promptWrite = null
  let runtimeExtraPrompts = { ...(config.extraPrompts || {}) }
  let runtimeExtraPromptPlacements = { ...(config.extraPromptPlacements || {}) }

  /** 把 extraPrompts / placements 写回 profile config；运行时先同步，避免等待重挂。 */
  const writeExtraPrompts = (next, placements, response, send) => {
    const editor = configEditor
    const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'ctx-mon-and-con') : undefined
    if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
    runtimeExtraPrompts = { ...next }
    runtimeExtraPromptPlacements = { ...placements }
    setGlobalExtraPrompts(next)
    setGlobalExtraPromptPlacements(placements)
    send(202, { ok: true, accepted: next, placements })
    void editor
      .edit(entry, (value) => ({ ...(value ?? {}), extraPrompts: next, extraPromptPlacements: placements }))
      .catch((error) => {
        promptWrite = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
      })
  }

  /** POST /inventory/extra-prompt {name, text}：新增或更新一条额外 system section。 */
  const extraPromptHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      const text = input?.text
      const placement = input?.placement === undefined ? 'system' : input.placement
      if (name.length === 0 || name.length > 80) return send(400, { ok: false, error: 'name is required (max 80 chars)' })
      if (typeof text !== 'string') return send(400, { ok: false, error: 'text is required' })
      if (text.trim().length === 0) return send(400, { ok: false, error: 'text must not be empty' })
      if (placement !== 'system' && placement !== 'user') return send(400, { ok: false, error: "placement must be 'system' or 'user'" })
      const next = { ...runtimeExtraPrompts, [name]: text }
      const placements = { ...runtimeExtraPromptPlacements }
      if (placement === 'user') placements[name] = 'user'
      else delete placements[name]
      writeExtraPrompts(next, placements, response, send)
    })
  }

  /** POST /inventory/extra-prompt/reset {name?}：移除一条或全部额外 system section。 */
  const extraPromptResetHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      const next = name ? Object.fromEntries(Object.entries(runtimeExtraPrompts).filter(([key]) => key !== name)) : {}
      const placements = name
        ? Object.fromEntries(Object.entries(runtimeExtraPromptPlacements).filter(([key]) => key !== name))
        : {}
      writeExtraPrompts(next, placements, response, send)
    })
  }

  /** 把 promptOverrides 写回 profile config。 */
  const writePromptOverrides = (next, response, send) => {
    const editor = configEditor
    const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'ctx-mon-and-con') : undefined
    if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
    send(202, { ok: true, accepted: next })
    void editor
      .edit(entry, (value) => ({ ...(value ?? {}), promptOverrides: next }))
      .then(() => {
        promptWrite = { at: new Date().toISOString(), promptOverrides: next }
      })
      .catch((error) => {
        promptWrite = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
      })
  }

  /** POST /inventory/prompt {name, text}：全局覆盖一个提示词 section。 */
  const promptEditHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      if (typeof input?.name !== 'string' || input.name.length === 0 || typeof input.text !== 'string') return send(400, { ok: false, error: 'name/text are required' })
      const next = { ...(config.promptOverrides || {}), [input.name]: input.text }
      writePromptOverrides(next, response, send)
    })
  }

  /** POST /inventory/prompt/reset {name?}：恢复一个或全部提示词原文。 */
  const promptResetHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const current = { ...(config.promptOverrides || {}) }
      const next = typeof input?.name === 'string' && input.name.length > 0 ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== input.name)) : {}
      writePromptOverrides(next, response, send)
    })
  }

  /** 会话级提示词文本覆盖：POST /inventory/prompt/session {name, text, sessionId?}。 */
  const sessionPromptHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      if (typeof input?.name !== 'string' || input.name.length === 0 || typeof input.text !== 'string') return send(400, { ok: false, error: 'name/text are required' })
      const targetId = typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : latestSession()?.id
      if (!targetId) return send(409, { ok: false, error: 'no session yet' })
      setSessionPromptText(targetId, input.name, input.text)
      saveSessionToggles()
      return send(202, { ok: true, layer: 'session', sessionId: targetId, name: input.name })
    })
  }

  /** 清除会话级提示词文本覆盖：POST /inventory/prompt/session/reset {name?, sessionId?}。 */
  const sessionPromptResetHandler = (request, response) => {
    const send = (code, payload) => {
      response.statusCode = code
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(payload))
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      return send(405, { ok: false, error: 'method not allowed' })
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: 'invalid body' })
      }
      const targetId = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : latestSession()?.id
      if (!targetId) return send(409, { ok: false, error: 'no session yet' })
      clearSessionPromptText(targetId, typeof input?.name === 'string' && input.name.length > 0 ? input.name : undefined)
      saveSessionToggles()
      return send(202, { ok: true, layer: 'session', sessionId: targetId })
    })
  }

  ctx.inject(['webServer'], (sub) => {
    const server = sub?.webServer
    if (!server || typeof server.register !== 'function') return
    const register = () => {
      const offs = [
        server.register({ kind: 'exact', path: STATUS_PATH, handler: statusHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/config`, handler: configHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/live`, handler: liveHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/analytics`, handler: analyticsHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/session-detail`, handler: sessionDetailHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/config/preset`, handler: presetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory`, handler: inventoryHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/toggle`, handler: inventoryToggleHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/reset`, handler: inventoryResetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt`, handler: promptEditHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/reset`, handler: promptResetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session`, handler: sessionPromptHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session/reset`, handler: sessionPromptResetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/extra-prompt`, handler: extraPromptHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/extra-prompt/reset`, handler: extraPromptResetHandler }),
      ]
      return () => offs.forEach((off) => off())
    }
    if (typeof sub.effect === 'function') sub.effect(register, 'ctx-mon-and-con: routes')
    else register()
  })

  // 注意：本文件是宿主半侧，只读测量、不改会话历史。真正的「控制」在
  // control.js：它必须挂在 agent preset 的 compaction 组里，才能看到
  // ctx.compaction 并调用 compactNow / compactIfNeeded。
}
