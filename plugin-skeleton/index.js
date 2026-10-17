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
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  budgetFor,
  clearSessionToggles,
  clearSessionPromptText,
  hydrateSessionToggles,
  setGlobalDisabledTools,
  setGlobalPromptOverrides,
  getAppliedTools,
  getInventory,
  getSessionDisabledPrompts,
  getSessionDisabledTools,
  setSessionPromptEnabled,
  setSessionPromptText,
  setSessionToolEnabled,
  snapshotSessionToggles,
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
const PLUGIN_VERSION = '0.12.2'

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
  // 全局禁用的工具名（从每个请求的 tools 里摘掉，schema token 一并省掉）。
  disabledTools: [],
  // 全局提示词覆盖：section name -> 替换文本；空对象表示全部用原文。
  promptOverrides: {},
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
const NUMERIC_KEYS = ['contextWindowTokens', 'warnAt', 'errorAt']

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
  const config = { ...DEFAULT_CONFIG, disabledTools: [], promptOverrides: {} }
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
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key) && key !== 'disabledTools' && key !== 'promptOverrides') issues.push({ message: 'unknown config key', path: [key] })
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

const SOURCE_HINTS = {
  section(name) {
    if (name.startsWith('harness:') || name.startsWith('deployment:')) return 'dsh-system-prompt'
    if (name.startsWith('tools:')) return 'dsh-tools'
    if (name.startsWith('tool:')) return 'dsh-tools'
    if (name.startsWith('ui:')) return 'dsh-client-ui-deliverables'
    if (name === 'plan:policy') return 'dsh-plan-mode'
    if (name === 'app:web-surface') return 'dsh-web-app'
    if (name === 'mcp-resource-servers') return 'dsh-mcp'
    return null
  },
  tool(name) {
    if (name === 'bash') return 'dsh-bash-local'
    if (['read', 'write', 'edit', 'glob', 'grep', 'read_image'].includes(name)) return 'dsh-client-ui-sidebar-files'
    if (['job_list', 'job_kill', 'job_output'].includes(name)) return 'dsh-api-job-controller'
    if (name === 'skill') return 'dsh-client-ui-skill'
    if (['get_goal', 'create_goal', 'update_goal'].includes(name)) return 'dsh-client-ui-goal'
    if (name === 'todo_write') return 'dsh-client-ui-plan'
    if (['subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'send_message'].includes(name)) return 'dsh-agent'
    if (name === 'ask_user_question') return 'dsh-client-ui-input-trigger'
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

let toolSourceIndex = null
const TOOL_INDEX_MAX_FILES = 700
const TOOL_INDEX_MAX_BYTES = 2 * 1024 * 1024

/** 扫描各包 lib 下的注册代码，建立 tool name -> 真实文件索引（一次，缓存）。 */
const ensureToolIndex = () => {
  if (toolSourceIndex !== null) return toolSourceIndex
  toolSourceIndex = new Map()
  const root = packagesRoot()
  if (!root || !existsSync(root)) return toolSourceIndex
  let scanned = 0
  const walk = (dir, depth) => {
    if (scanned >= TOOL_INDEX_MAX_FILES || depth > 2) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (scanned >= TOOL_INDEX_MAX_FILES) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'client') continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      if (entry.name.includes('client')) continue
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size > TOOL_INDEX_MAX_BYTES) continue
      scanned += 1
      let text
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const match of text.matchAll(/\bname\s*:\s*['"]([A-Za-z0-9_-]+)['"]/g)) {
        if (!toolSourceIndex.has(match[1])) toolSourceIndex.set(match[1], full)
      }
    }
  }
  let packages = []
  try {
    packages = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {}
  for (const pkg of packages) {
    if (scanned >= TOOL_INDEX_MAX_FILES) break
    walk(join(root, pkg, 'lib'), 0)
  }
  return toolSourceIndex
}

const toolSourceFile = (name) => {
  try {
    const found = ensureToolIndex().get(name)
    if (found) return found
  } catch {}
  const pkg = SOURCE_HINTS.tool(name)
  return pkg ? sourceFileFor(pkg) : null
}

const sourcesFor = (inventory) => {
  const sections = {}
  const tools = {}
  for (const section of inventory && Array.isArray(inventory.sections) ? inventory.sections : []) {
    sections[section.name] = sourceFileFor(SOURCE_HINTS.section(section.name))
  }
  for (const tool of inventory && Array.isArray(inventory.tools) ? inventory.tools : []) {
    tools[tool.name] = toolSourceFile(tool.name)
  }
  return { sections, tools }
}

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
  setGlobalPromptOverrides(config.promptOverrides)
  setGlobalDisabledTools(config.disabledTools)

  // 会话级开关持久化：~/.dsh/ctx-mon-and-con/session-toggles.json（按 sessionId 区分，跨 profile 共享）。
  const SESSION_TOGGLES_PATH = join(homedir(), '.dsh', 'ctx-mon-and-con', 'session-toggles.json')
  const saveSessionToggles = () => {
    try {
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
      breakdown: breakdownOf(session),
      ratio: typeof used === 'number' && budget > 0 ? used / budget : null,
    })
  }

  /** 找到 agent preset 行；只有存在 preset-standard 的组合才能一键挂控制行。 */
  const findPresetEntry = () => {
    const editor = configEditor
    if (!editor || typeof editor.entries !== 'function') return null
    return editor.entries().find((entry) => entry?.options?.id === 'preset-standard') ?? null
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
      void editor
        .edit(entry, (current) => mutatePreset(current, input.enable))
        .catch((error) => {
          const logger = ctx.logger
          if (typeof logger?.warn === 'function') logger.warn(`ctx-mon-and-con: preset write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    })
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
      configEditable: Boolean(configEditor && typeof configEditor.edit === 'function'),
      measurements: [...measurements.values()].reverse(),
    })
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(body)
  }

  // 可写配置：宿主平面有 configEditor 服务时（Web/Desktop profile 都有），
  // 面板可以把预算/阈值写回 profile 的 patch 层，写完后 Loader 会按新配置重挂本插件。
  let configEditor = null
  ctx.inject(['configEditor'], (sub) => {
    configEditor = sub?.configEditor ?? null
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
    for (const key of ['warnAt', 'errorAt']) {
      if (input[key] === undefined) continue
      if (typeof input[key] !== 'number' || !(input[key] > 0 && input[key] <= 1)) return null
      ratios[key] = input[key]
    }
    const warn = ratios.warnAt ?? config.warnAt
    const error = ratios.errorAt ?? config.errorAt
    if (!(warn < error)) return null
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
        send(202, { ok: true, layer })
        void editor
          .edit(entry, (value) => ({ ...(value ?? {}), disabledTools: [], promptOverrides: {} }))
          .catch((error) => {
            promptWrite = { at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
          })
        return
      }
      return send(202, { ok: true, layer })
    })
  }

  let promptWrite = null

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
        server.register({ kind: 'exact', path: `${STATUS_PATH}/config/preset`, handler: presetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory`, handler: inventoryHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/toggle`, handler: inventoryToggleHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/reset`, handler: inventoryResetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt`, handler: promptEditHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/reset`, handler: promptResetHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session`, handler: sessionPromptHandler }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session/reset`, handler: sessionPromptResetHandler }),
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
