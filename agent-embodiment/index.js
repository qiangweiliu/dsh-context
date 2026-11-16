/**
 * agent-embodiment — DSH 的上下文、感官、工具与 agent 脚手架插件（node 侧最小可用骨架）
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

export const name = 'agent-embodiment'

/** 与 control.js 共享的进程内状态（同一包内相对 import，不涉及 npm 依赖）。 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectProfileName, migrateStateFiles, resolveStateRoots, stateDirFor } from './profile.js'
import { createScaffoldRoutes } from './routes-scaffold.js'
import { createSkillRoutes } from './routes-skills.js'
import { getSkillsScope } from './state.js'
import { createSessionRoutes } from './routes-session.js'
import { createStatusRoutes } from './routes-status.js'
import { createInventoryRoutes } from './routes-inventory.js'
import { createAnalytics, sessionsNewestFirst } from './analytics.js'
import { createRuntime } from './runtime.js'

import {
  budgetFor,
  clearSessionToggles,
  clearSessionPromptText,
  clearAllSessionToggles,
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
  getSessionPromptTextMap,
  setSessionPromptEnabled,
  setAutoMountControl,
  setSessionPromptText,
  setSessionToolEnabled,
  snapshotSessionToggles,
  control as controlState,
  getSessionBudget,
  getControlBudget,
  listSessionBudgets,
  setDefaultBudget,
  setDefaultTriggerAt,
  setDefaultKeepTokens,
  setDefaultTargetAt,
  setSessionBudget,
  clearSessionBudget,
} from './state.js'

import { DEFAULT_MODEL_PRICING, PRICING_CURRENCY, PRICING_META, PRICING_SOURCE, PRICING_UPDATED_AT, beijingYear, configureHolidays, csvCell, csvDocument, foldSession, holidayInfo, isPeakTime, sessionDetail, summarizeFolds } from './metrics.js'
import { atomicWriteFile, backupFile as backupStateFile, latestBackupJson as latestStateBackup } from './persist.js'
import { buildHealth, buildInsights } from './insights.js'

/** 依赖的真实服务名（见 @deepseek-ai/dsh-commands / @deepseek-ai/dsh-token-meter）。 */
export const inject = ['commands', 'tokenMeter']

/** 与 package.json 的 version 保持一致（只用于状态接口的自述）。 */
const MANIFEST = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const PLUGIN_VERSION = MANIFEST.version

/** 兼容声明原样下发给面板：范围（engines）与逐版本验证状态（dshReleases）是两件事。 */
const COMPATIBILITY = {
  engines: MANIFEST.dsh?.compatibility?.dsh ?? MANIFEST.engines?.dsh ?? null,
  releases: MANIFEST.dsh?.compatibility?.dshReleases ?? {},
}

/** 浏览器半侧 client.js 拉的只读状态接口；两处路径必须一致。 */
const sendJson = (response, code, payload) => {
  response.statusCode = code
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

const jsonSender = (response) => (code, payload) => sendJson(response, code, payload)

const requireMethod = (request, response, method) => {
  if (request.method === method) return true
  response.setHeader('allow', method)
  sendJson(response, 405, { ok: false, error: 'method not allowed' })
  return false
}

const STATUS_PATH = '/api/agent-embodiment/status'

/** 所有 POST 接口的默认请求体上限；配置写入另有更小的 16KB 上限。 */
const MAX_BODY_BYTES = 256 * 1024

/** 内存里最多保留多少条会话测量（进程内，重启即清空）。 */
const MAX_MEASUREMENTS = 10

/** 压缩策略 preset：只在用户没有显式覆盖 trigger/target/keep 时生效。 */
const COMPRESSION_STRATEGIES = Object.freeze({
  conservative: { triggerAt: 0.9, targetAt: 0.7, keepRatio: 0.35 },
  balanced: { triggerAt: 0.9, targetAt: 0.6, keepRatio: 0.25 },
  aggressive: { triggerAt: 0.75, targetAt: 0.5, keepRatio: 0.1 },
})

const DEFAULT_CONFIG = {
  // 上下文窗口上下文（token）。不同模型窗口不同，按需覆盖。
  contextWindowTokens: 128000,
  // 压缩策略 preset：conservative / balanced / aggressive。
  compressionStrategy: 'balanced',
  // 达到窗口的多少比例时标记“警告”（只影响标记/颜色，不触发压缩）。
  warnAt: 0.75,
  // 达到窗口的多少比例时标记“超限”（只影响标记/颜色，不做拦截）。
  errorAt: 0.9,
  // 自动压缩的触发比例（0–1；0.9 = 到 90% 预压缩，1 = 到上下限才触发）。
  triggerAt: 0.9,
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
  // 跨会话分析默认扫描多少个会话（1..200；页面可用 ?limit= 临时覆盖）。
  analyticsLimit: 40,
  // 追加的用户价格表：[{ match: '正则', input, cacheRead, cacheWrite, output }]，单位 CNY / 1M tokens。
  // 排在内置表之前，因此同名模型可以用它覆盖或补充。
  modelPricing: [],
  // 额外的法定节假日（YYYY-MM-DD），与内置表合并；用于跨年不必改代码/发版。
  holidays: [],
  // true 时忽略内置节假日表，只用 `holidays`（完全接管）。
  holidaysIgnoreBuiltin: false,
  // 首次运行/修复时，允许把控制行补挂进 agent preset；默认关闭，必须由用户显式同意。
  autoMountControl: false,
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
const NUMERIC_KEYS = ['contextWindowTokens', 'warnAt', 'errorAt', 'triggerAt', 'targetAt']

/**
 * 内置提示词模板：只作为「新增提示词」的草稿来源，不默认注入。
 * 文本必须稳定（不含时间戳/会话 id），否则每次请求都会 miss 提示词缓存。
 *
 * 依据（每条都能指到来源，而不是拼口号）：
 * - Self-Discover (arXiv 2402.03620)：先按任务自选推理结构，MATH 上比 CoT 最高 +32%，
 *   比 self-consistency 省 10–40× 推理；→ "Structure first"，而不是固定一套步骤。
 * - Chain of Draft (arXiv 2502.18600)：中间推理只写要点，token 可降到 7.6%、精度不降；
 *   → "Think in drafts"，直接对治上一版模板 +86% 耗时的毛病。
 * - ReAct / Anthropic "Building effective agents"：结论必须有环境返回的证据支撑；
 *   → "Ground every claim"。
 * - Popper 可反驳性 + Chain-of-Verification/Reflexion：主动找反证、换路径复核；
 *   → "Attack your own answer"。
 * - Polya《怎样解题》(理解/计划/回顾) + Dewey 探究：先定义"怎样算做完"。
 * - 贝叶斯式置信校准：区分已验证/假设/未知。
 * - 12-factor agents / context engineering：上下文是稀缺资源，短提示词优先。
 */
export const PROMPT_TEMPLATES = [
  {
    id: 'method',
    text: [
      '## Working method',
      '',
      'Pick the method that fits the task; skip any step that changes nothing.',
      '',
      'Structure first. In one or two lines, name how you will attack this (deduction, case split, estimate-and-check, search, reproduce-then-fix) and what evidence would make it done. Do not force a structure that does not fit.',
      'Think in drafts. Intermediate reasoning stays short: keywords, numbers, one line per step. Verbose narration costs time and adds no accuracy.',
      'Ground every claim. A fact comes from a tool result in this session or from the user. Anything else is a guess: mark it as an assumption, or check it now.',
      'Attack your own answer. Before finishing, ask what would make it wrong, then look for that once. When the result is checkable, recompute it by a different route or on a boundary case.',
      'Answer the question asked. Deliver the requested form; when the task has a single checkable result, put it on its own final line so it can be read directly.',
      'Report what you know. Keep verified, assumed, and unknown apart; state material uncertainty instead of smoothing it over.',
      'Stop at done. Further polish has diminishing returns; extra length is a cost.',
    ].join('\n'),
  },
]

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
  const config = { ...DEFAULT_CONFIG, disabledTools: [], promptOverrides: {}, extraPrompts: {}, extraPromptPlacements: {}, modelPricing: [], autoMountControl: false, keepTokens: 0 }
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
  if (raw.modelPricing !== undefined) {
    if (!Array.isArray(raw.modelPricing)) {
      issues.push({ message: 'expected an array of pricing rows', path: ['modelPricing'] })
    } else {
      const rows = []
      for (const [index, row] of raw.modelPricing.entries()) {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          issues.push({ message: 'expected an object', path: ['modelPricing', index] })
          break
        }
        const okNumber = (value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        if (typeof row.match !== 'string' || row.match.trim().length === 0) {
          issues.push({ message: 'expected a non-empty regex', path: ['modelPricing', index, 'match'] })
          break
        }
        try { new RegExp(row.match, 'i') } catch {
          issues.push({ message: 'invalid regex', path: ['modelPricing', index, 'match'] })
          break
        }
        if (!okNumber(row.input) || !okNumber(row.cacheRead) || !okNumber(row.cacheWrite) || !okNumber(row.output)) {
          issues.push({ message: 'prices must be non-negative numbers', path: ['modelPricing', index] })
          break
        }
        if (typeof row.input !== 'number' || typeof row.output !== 'number') {
          issues.push({ message: 'input and output prices are required', path: ['modelPricing', index] })
          break
        }
        // 可选峰谷两档：只要给出 peak/offPeak 里任一档，就按各自时段取价；
        // 缺省的字段回落到平档值，没给 peak/offPeak 的行仍是全天同价。
        const rateBand = (value) => {
          if (value === undefined) return null
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid'
          const fields = ['input', 'cacheRead', 'cacheWrite', 'output']
          if (!fields.every((field) => okNumber(value[field]))) return 'invalid'
          if (typeof value.input !== 'number' || typeof value.output !== 'number') return 'invalid'
          return { input: value.input, cacheRead: value.cacheRead ?? 0, cacheWrite: value.cacheWrite ?? value.input, output: value.output }
        }
        const peak = rateBand(row.peak)
        const offPeak = rateBand(row.offPeak)
        if (peak === 'invalid' || offPeak === 'invalid') {
          issues.push({ message: 'peak/offPeak must contain non-negative input and output numbers', path: ['modelPricing', index] })
          break
        }
        rows.push({
          match: row.match,
          input: row.input,
          cacheRead: row.cacheRead ?? 0,
          cacheWrite: row.cacheWrite ?? row.input,
          output: row.output,
          ...(peak ? { peak } : {}),
          ...(offPeak ? { offPeak } : {}),
        });
      }
      config.modelPricing = rows
    }
  }
  if (raw.holidays !== undefined) {
    if (!Array.isArray(raw.holidays) || raw.holidays.length > 400) {
      issues.push({ message: 'expected an array of YYYY-MM-DD strings (max 400)', path: ['holidays'] })
    } else if (!raw.holidays.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value.trim()))) {
      issues.push({ message: 'each holiday must be YYYY-MM-DD', path: ['holidays'] })
    } else {
      config.holidays = [...new Set(raw.holidays.map((value) => value.trim()))].sort()
    }
  }
  if (raw.holidaysIgnoreBuiltin !== undefined) {
    if (typeof raw.holidaysIgnoreBuiltin !== 'boolean') {
      issues.push({ message: 'expected a boolean', path: ['holidaysIgnoreBuiltin'] })
    } else config.holidaysIgnoreBuiltin = raw.holidaysIgnoreBuiltin
  }
  if (raw.compressionStrategy !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(COMPRESSION_STRATEGIES, raw.compressionStrategy)) {
      issues.push({ message: `expected one of ${Object.keys(COMPRESSION_STRATEGIES).join(', ')}`, path: ['compressionStrategy'] })
    } else config.compressionStrategy = raw.compressionStrategy
  }
  if (raw.analyticsLimit !== undefined) {
    if (!Number.isInteger(raw.analyticsLimit) || raw.analyticsLimit < 1 || raw.analyticsLimit > 200) {
      issues.push({ message: 'expected an integer in 1..200', path: ['analyticsLimit'] })
    } else config.analyticsLimit = raw.analyticsLimit
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
  // preset 只在字段未显式出现时填默认，显式值优先。
  const strategy = COMPRESSION_STRATEGIES[config.compressionStrategy] ?? COMPRESSION_STRATEGIES.balanced
  if (raw.triggerAt === undefined) config.triggerAt = strategy.triggerAt
  if (raw.targetAt === undefined) config.targetAt = strategy.targetAt
  if (raw.keepTokens === undefined && config.compressionStrategy !== 'balanced' && config.contextWindowTokens > 0) config.keepTokens = Math.round(config.contextWindowTokens * strategy.keepRatio)
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
    vendor: 'agent-embodiment',
    validate: validateConfig,
  }),
})

const SOURCE_HINTS = {
  section(name) {
    if (name.startsWith('agent-embodiment:extra:') || name.startsWith('ctx-mon-and-con:extra:')) return 'agent-embodiment (extra)'
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

/** 每个提示词 section 的来源标签：稳定的包名/固定串，不做宿主路径猜测。 */
const sourcesFor = (inventory) => {
  const sections = {}
  for (const section of inventory && Array.isArray(inventory.sections) ? inventory.sections : []) {
    if (section.name.startsWith('agent-embodiment:extra:') || section.name.startsWith('ctx-mon-and-con:extra:')) {
      sections[section.name] = 'agent-embodiment/control.js'
      continue
    }
    const hint = SOURCE_HINTS.section(section.name)
    sections[section.name] = hint ? `@deepseek-ai/${hint}` : null
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

/** 统一的 /embody 输出：一眼看到“用了多少 / 上下文多少 / 是否该压缩”。 */
function renderUsage(measurement, budget, config) {
  const used = measurement.totalTokens
  const ratio = used / budget
  const status = ratio >= config.errorAt ? '超限（建议立刻压缩）' : ratio >= config.warnAt ? '警告（接近上下文）' : 'ok'
  const lines = [
    `上下文：${formatTokens(used)} / ${formatTokens(budget)} tokens（${formatRatio(ratio)}，状态：${status}）`,
    `- 消息表面 surfaceTokens：${formatTokens(measurement.surfaceTokens)}`,
    `- 测量基线 baseline：${measurement.baseline?.kind ?? 'unknown'} ${formatTokens(measurement.baseline?.tokens ?? used)}`,
  ]
  if (Array.isArray(measurement.nodes)) lines.push(`- 计费节点 nodes：${measurement.nodes.length} 个`)
  lines.push('提示：/embody <tokens> 临时改本会话上下文，/embody reset 恢复默认（兼容 /ctx）；控制半侧挂进 preset 后到点自动压缩。')
  return lines.join('\n')
}

/**
 * 注册 `/embody`（并保留 `/ctx` 别名）：显示当前会话的 token 用量；可选参数临时覆盖上下文。
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

  // 成本估算：用户价格表排在内置表之前，因此可以覆盖或补充内置模型。
  const effectivePricing = Array.isArray(config.modelPricing) && config.modelPricing.length > 0
    ? [...config.modelPricing, ...DEFAULT_MODEL_PRICING]
    : DEFAULT_MODEL_PRICING

  // 节假日表：默认「内置 ∪ 配置补充」，`holidaysIgnoreBuiltin` 时完全用配置。
  // 放在这里是为了让 metrics.js 的成本估算与状态路由用同一份判定。
  configureHolidays({ add: config.holidays, ignoreBuiltin: config.holidaysIgnoreBuiltin })

  // 状态目录：0.21.0 从 ctx-mon-and-con 改名；首次启动把旧目录的状态文件复制过来。
  // 0.25.0 起按 profile 再分一层（识别依据：哪个 profile 的依赖真的指向本插件目录），
  // 识别不出来时沿用旧的共享目录，行为与以前一致。
  // 0.32.0 起尊重 DSH_HOME：隔离实例不能读真实 home 的 profiles，也不能往那儿写状态。
  const STATE_ROOTS = resolveStateRoots({ dshHome: process.env.DSH_HOME })
  const BASE_STATE_DIR = STATE_ROOTS.stateBase
  const LEGACY_STATE_DIR = STATE_ROOTS.legacyState
  const PROFILE_NAME = detectProfileName(STATE_ROOTS.profilesRoot, dirname(fileURLToPath(import.meta.url)))
  const STATE_DIR = stateDirFor(BASE_STATE_DIR, PROFILE_NAME)
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    for (const file of ['session-toggles.json', 'compaction-log.jsonl', 'onboarding.json']) {
      const source = join(LEGACY_STATE_DIR, file)
      const destination = join(STATE_DIR, file)
      if (!existsSync(destination) && existsSync(source)) copyFileSync(source, destination)
    }
  } catch {}
  // 共享目录 -> profile 目录的迁移（只补缺失文件，不覆盖已有数据）。
  migrateStateFiles(BASE_STATE_DIR, STATE_DIR)

  // 所有写操作前自动备份（profile patch 与状态文件），保留最近 30 份。
  // 状态文件用「临时文件 + rename」落盘：崩溃/断电最多丢最后一次写入，不会留下半截 JSON。
  // 具体实现见 persist.js（可单独测试）。
  // 0.38.0：状态与路径统一收进 runtime.js，handler 只需一个可注入依赖。
  const RUNTIME = createRuntime({
    config,
    home: STATE_ROOTS.home,
    dshHome: STATE_ROOTS.dshHome,
    stateDir: STATE_DIR,
    legacyStateDir: LEGACY_STATE_DIR,
    profileName: PROFILE_NAME,
  })
  const BACKUP_DIR = RUNTIME.paths.backupDir
  const backupFile = (filePath, label) => {
    const logger = ctx.logger
    const warn = typeof logger?.warn === 'function'
      ? (message) => logger.warn('agent-embodiment: backup failed: ' + message)
      : () => {}
    backupStateFile(BACKUP_DIR, filePath, label, warn)
  }
  const latestBackupJson = (label) => latestStateBackup(BACKUP_DIR, label)

  // 会话级开关持久化：<状态目录>/session-toggles.json（0.25.0 起按 profile 隔离）。
  const SESSION_TOGGLES_PATH = RUNTIME.paths.sessionTogglesPath
  const saveSessionToggles = () => {
    try {
      backupFile(SESSION_TOGGLES_PATH, 'session-toggles')
      mkdirSync(dirname(SESSION_TOGGLES_PATH), { recursive: true })
      atomicWriteFile(SESSION_TOGGLES_PATH, JSON.stringify(snapshotSessionToggles(), null, 2) + '\n')
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not save session toggles: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const loadSessionToggles = () => {
    try {
      if (!existsSync(SESSION_TOGGLES_PATH)) return
      hydrateSessionToggles(JSON.parse(readFileSync(SESSION_TOGGLES_PATH, 'utf8')))
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not load session toggles: ' + (error instanceof Error ? error.message : String(error)))
      // 主文件损坏（半截 JSON/磁盘错误）时回落到最近一份可用备份，避免静默丢全部会话开关。
      const recovered = latestBackupJson('session-toggles')
      if (recovered !== null) {
        hydrateSessionToggles(recovered)
        if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: session toggles restored from the latest backup')
      }
    }
  }
  loadSessionToggles()

  // 首次运行状态：~/.dsh/agent-embodiment/onboarding.json。
  // 不写 profile config（避免用户还没同意就触发插件重挂）；只记录向导是否完成、
  // 预算是否确认，以及是否授权写 agent preset。
  const ONBOARDING_PATH = RUNTIME.paths.onboardingPath
  // 对象身份保持不变（就地更新），runtime 只持有引用，避免构造顺序问题。
  const onboarding = {
    completed: false,
    dismissed: false,
    // “稍后”不是永久关闭：记录一个时间戳，短时间内不再打扰，之后仍会再次出现。
    deferredAt: null,
    budgetConfirmed: false,
    budgetTokens: config.contextWindowTokens,
    presetConsent: null,
    at: null,
    version: PLUGIN_VERSION,
  }
  RUNTIME.setOnboarding(onboarding)
  const saveOnboarding = () => {
    try {
      mkdirSync(dirname(ONBOARDING_PATH), { recursive: true })
      backupFile(ONBOARDING_PATH, 'onboarding')
      atomicWriteFile(ONBOARDING_PATH, JSON.stringify(onboarding, null, 2) + '\n')
      bumpStatusRevision()
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not save onboarding: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const applyOnboarding = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    Object.assign(onboarding, {
      completed: raw.completed === true,
      dismissed: raw.dismissed === true,
      deferredAt: typeof raw.deferredAt === 'string' ? raw.deferredAt : null,
      budgetConfirmed: raw.budgetConfirmed === true,
      budgetTokens: Number.isInteger(raw.budgetTokens) && raw.budgetTokens > 0 ? raw.budgetTokens : config.contextWindowTokens,
      presetConsent: raw.presetConsent === true ? true : raw.presetConsent === false ? false : null,
      at: typeof raw.at === 'string' ? raw.at : null,
      version: typeof raw.version === 'string' ? raw.version : PLUGIN_VERSION,
  })
    return true
  }
  const loadOnboarding = () => {
    try {
      if (!existsSync(ONBOARDING_PATH)) return
      applyOnboarding(JSON.parse(readFileSync(ONBOARDING_PATH, 'utf8')))
    } catch (error) {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not load onboarding: ' + (error instanceof Error ? error.message : String(error)))
      if (applyOnboarding(latestBackupJson('onboarding')) && typeof logger?.warn === 'function') {
        logger.warn('agent-embodiment: onboarding state restored from the latest backup')
      }
    }
  }
  loadOnboarding()

  // 压缩记录持久化：~/.dsh/agent-embodiment/compaction-log.jsonl（JSONL，内存最多 200 条）。
  const COMPACTION_LOG_PATH = RUNTIME.paths.compactionLogPath
  const COMPACTION_LOG_MAX_BYTES = 512 * 1024
  // 截断目标是 maxBytes 的一半：避免在 512KB 边界反复 append 就触发一次全量读+重写。
  // 超过高水位后截到低水位，给后续 append 留出缓冲，减少 O(文件大小) 的同步重写频次。
  const COMPACTION_LOG_TRIM_BYTES = 256 * 1024
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
      if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not load compaction log: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  loadCompactionLog()
  ctx.effect(() => {
    const unsubscribe = subscribeCompactionLog((entry) => {
      try {
        mkdirSync(dirname(COMPACTION_LOG_PATH), { recursive: true })
        appendFileSync(COMPACTION_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8')
        // 体积过大时只保留最近 N 行，避免长期运行无限增长。截到低水位（256KB）而非
        // 刚好 400 行：否则下一次 append 又立刻超过 512KB，每条都触发一次全量读+重写。
        if (statSync(COMPACTION_LOG_PATH).size > COMPACTION_LOG_MAX_BYTES) {
          const lines = readFileSync(COMPACTION_LOG_PATH, 'utf8').split('\n').filter((line) => line.trim().length > 0)
          let keep = COMPACTION_LOG_KEEP_LINES
          let bytes = 0
          // 从尾部往前累计，直到接近低水位（至少保留 50 行，避免极端单行过大时误删）。
          for (let index = lines.length - 1; index >= 0; index -= 1) {
            bytes += Buffer.byteLength(lines[index], 'utf8') + 1
            keep = lines.length - index
            if (bytes >= COMPACTION_LOG_TRIM_BYTES && keep >= 50) break
          }
          atomicWriteFile(COMPACTION_LOG_PATH, lines.slice(lines.length - keep).join('\n') + '\n')
        }
        bumpStatusRevision()
      } catch (error) {
        const logger = ctx.logger
        if (typeof logger?.warn === 'function') logger.warn('agent-embodiment: could not append compaction log: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
    return () => unsubscribe()
  }, 'agent-embodiment: compaction log persistence')
  // 浏览器状态接口的数据源：按 session id 保留最近 MAX_MEASUREMENTS 条。
  const measurements = new Map()

  const sessionIdOf = (agent) => agent?.session?.id ?? agent?.sessionId

  /**
   * 会话列表的排序键。sessionQuery 的 header 只有 createdAt；如果宿主/未来版本
   * 提供 updatedAt/lastActivityAt，优先用更接近“最近活动”的字段。
   */
  const budgetOf = (agent) => budgetFor(sessionIdOf(agent), config.contextWindowTokens)

  /** 把一次测量压进内存表，供浏览器设置面板读取。 */
  const recordMeasurement = (agent, measurement, budget) => {
    const sessionId = sessionIdOf(agent) ?? 'unknown'
    const override = getSessionBudget(sessionId)
    const ratio = budget > 0 ? measurement.totalTokens / budget : 0
    const status = ratio >= config.errorAt ? 'error' : ratio >= config.warnAt ? 'warn' : 'ok'
    measurements.delete(sessionId)
    const breakdown = breakdownOf(agent?.session, measurement)
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
    bumpStatusRevision()
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
          return { kind: 'error', text: '用法：/embody [tokens|reset]（例如 /embody 200000 或 /embody reset；兼容 /ctx）' }
        }
        const next = Number(argument)
        if (!Number.isSafeInteger(next) || next <= 0) {
          return { kind: 'error', text: '上下文必须是正整数 token 数。' }
        }
        if (typeof sessionId !== 'string' || !setSessionBudget(sessionId, next)) {
          return { kind: 'error', text: '当前会话没有可用的 id，无法设置上下文。' }
        }
        budget = next
        prefix = `已把本会话上下文改为 ${formatTokens(budget)} tokens（会话级覆盖；/embody reset 可清除）。\n`
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

  // 用 effect 注册：卸载插件时 Cordis 执行返回的 disposer 注销命令。handler 是同步的。
  // /embody 是规范命令；/ctx 保留为兼容别名，避免已有用户/脚本失效。
  ctx.effect(() => {
    const disposers = ['embody', 'ctx'].map((name) => ctx.commands.register({
      name,
      description: name === 'embody' ? 'Show this session context budget and usage' : 'Legacy alias for /embody',
      input: { hint: '[tokens|reset]' },
      handler,
    }))
    return () => disposers.forEach((dispose) => dispose())
  }, 'agent-embodiment: /embody and /ctx commands')

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
      presetRow: 'agent-embodiment/control',
      ...presetMountState(),
      hint: controlState.active
        ? 'control row is mounted and enforcing the budget'
        : 'mount agent-embodiment/control inside the agent preset (Settings → Agent preset → compaction group)',
    }
  }

  // 会话查找与预设挂载：给「实时占用」指示器与「启用自动压缩」按钮用。
  ctx.inject(['sessionProjections'], (sub) => {
    RUNTIME.setSessionProjections(sub?.sessionProjections ?? null)
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setSessionProjections(null) }, 'agent-embodiment: projections presence')
  })

  /**
   * 官方 contextBreakdown 只给 system/tools/message 三桶；这里再把 message 拆成
   * 「本轮用户消息」与「上文」，得到四桶（skill 内容并进系统提示词/工具定义，不单列）。
   * @returns {{ systemTokens: number, toolsTokens: number, historyTokens: number, userTokens: number, totalTokens: number } | null}
   */
  const breakdownOf = (session, measurement) => {
    if (!session) return null
    // /live 与 /embody 已经测量过一次；把结果传进来，避免对长会话重复全量测量。
    let measured = measurement
    if (measured === undefined) {
      try {
        measured = ctx.tokenMeter.measure(session)
      } catch {
        return null
      }
    }
    const nodes = Array.isArray(measured?.nodes) ? measured.nodes : []
    let systemTokens = 0
    let toolsTokens = 0
    let messageTokens = null
    try {
      const snapshot = RUNTIME.getSessionProjections() && typeof RUNTIME.getSessionProjections().snapshot === 'function'
        ? RUNTIME.getSessionProjections().snapshot(session, ['contextBreakdown'])
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

  ctx.inject(['sessions'], (sub) => {
    RUNTIME.setSessions(sub?.sessions ?? null)
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setSessions(null) }, 'agent-embodiment: sessions presence')
  })

  // 浏览器/API 认证：DSH 把认证放在 connection 的 /api 前缀路由里，本插件注册的是
  // 精确路由，必须自己调用官方 admission，否则会绕过 Host/Origin 与 cookie 校验。
  ctx.inject(['connection'], (sub) => {
    RUNTIME.setConnection(sub?.connection ?? null)
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setConnection(null) }, 'agent-embodiment: connection presence')
  })

  /** 是否挂了 webServer（浏览器形态）。在注册路由时置位，用于鉴权失败关闭。 */

  /**
   * 用 DSH 的 requestRejection 决定是否放行。
   * 没有 connection 时：
   *   - 纯 headless（没有 webServer）→ 放行，保持 headless 兼容；
   *   - 有 webServer 但没有 connection → 403 失败关闭，避免自定义组合下状态路由裸奔。
   * 检查本身抛错时同样按 403 失败关闭。
   */
  const requestRejection = (request) => {
    if (!RUNTIME.getConnection()) return RUNTIME.isWebServerPresent() ? 403 : undefined
    try {
      return typeof RUNTIME.getConnection().requestRejection === 'function'
        ? RUNTIME.getConnection().requestRejection(request)
        : 403
    } catch {
      return 403
    }
  }

  const authed = (handler) => (request, response) => {
    const rejection = requestRejection(request)
    if (rejection) {
      response.statusCode = rejection
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return undefined
    }
    return handler(request, response)
  }

  const requestUrl = (request) => new URL(request.url ?? '/', 'http://localhost')

  /**
   * 读取 JSON 请求体并交给 handle。非法 JSON 回 400；
   * 传 limitBytes 时超限回 413 并断开连接。
   * 只接受 application/json，避免跨站 text/plain 简单请求触发写操作。
   */
  const readJson = (request, response, handle, limitBytes = MAX_BODY_BYTES, invalidError = 'invalid body') => {
    const send = jsonSender(response)
    const contentType = String(request.headers?.['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      response.statusCode = 415
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ ok: false, error: 'content-type must be application/json' }))
      return
    }
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        response.statusCode = 413
        response.end()
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size > limitBytes) return
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { ok: false, error: invalidError })
      }
      handle(input)
    })
  }

  /** GET 实时占用：按 sessionId 找到 Session，用 tokenMeter 现场测量。 */
  /** 常见 preset id；desktop app 等环境可能用其他 id。 */
  const PRESET_IDS = ['preset-standard', 'preset-desktop', 'desktop', 'agent-preset', 'default', 'preset-default']

  /** 列出可编辑的 preset 候选：优先已知 id，其次任何带 plugins 配置的行。 */
  const listPresetEntries = () => {
    const editor = RUNTIME.getConfigEditor()
    if (!editor || typeof editor.entries !== 'function') return []
    return editor.entries().filter((entry) => entry && Array.isArray(entry.options?.config?.plugins))
  }

  /** 找到已知 id 的 preset；自动挂载只允许改这些，避免猜错 preset。 */
  const findKnownPresetEntry = () => {
    const entries = listPresetEntries()
    for (const id of PRESET_IDS) {
      const hit = entries.find((entry) => entry.options?.id === id)
      if (hit) return hit
    }
    return null
  }

  /** 面板/状态展示用：已知 id 找不到时允许退到第一个候选。 */
  const findPresetEntry = () => {
    const known = findKnownPresetEntry()
    if (known) return known
    const entries = listPresetEntries()
    return entries.find((entry) => typeof entry.options?.id === 'string' && entry.options.id.includes('preset')) ?? entries[0] ?? null
  }

  const CONTROL_ROW_ID = 'agent-embodiment-control'
  const LEGACY_CONTROL_ROW_ID = 'ctx-mon-and-con-control'
  const CONTROL_ROW = Object.freeze({ id: CONTROL_ROW_ID, name: 'agent-embodiment/control', config: { mode: 'idle' } })

  /** 读取 preset 里压缩组是否已经挂了我们的控制行。 */
  const presetMountState = (entry = findPresetEntry()) => {
    if (!entry) return { presetMountable: false, presetMounted: false }
    const plugins = Array.isArray(entry.options?.config?.plugins) ? entry.options.config.plugins : []
    const group = plugins.find((row) => row && row.id === 'compaction' && Array.isArray(row.config))
    const rows = group && Array.isArray(group.config) ? group.config : []
    return {
      presetMountable: true,
      presetMounted: rows.some((row) => row && row.id === CONTROL_ROW_ID) && !rows.some((row) => row && row.id === LEGACY_CONTROL_ROW_ID),
    }
  }

  const presetWarn = (message) => {
    const logger = ctx.logger
    if (typeof logger?.warn === 'function') logger.warn(`agent-embodiment: ${message}`)
  }

  /** 写完 preset 后回读，避免静默失败（DSH 升级改了 preset 结构时尤其重要）。 */
  const verifyPresetMount = (expected, label, entry = findPresetEntry()) => {
    const state = presetMountState(entry)
    if (state.presetMounted !== expected) {
      presetWarn(`${label}: preset mount is ${state.presetMounted}, expected ${expected}`)
      return false
    }
    return true
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
    const previousRows = Array.isArray(group.config) ? group.config : []
    const existingControl = previousRows.find((row) => row && row.id === CONTROL_ROW_ID)
    const children = previousRows.filter((row) => !(row && (row.id === CONTROL_ROW_ID || row.id === LEGACY_CONTROL_ROW_ID)))
    if (enable) {
      // 保留用户改过的 mode/cooldownMs 等字段；只在缺失时补默认 config。
      children.push(existingControl
        ? { ...existingControl, name: typeof existingControl.name === 'string' && existingControl.name.length > 0 ? existingControl.name : CONTROL_ROW.name, config: existingControl.config ?? CONTROL_ROW.config }
        : CONTROL_ROW)
    }
    plugins[index] = { ...group, config: children }
    return { ...base, plugins }
  }

  /** POST /config/preset {enable:boolean}：把控制行写进 preset-standard 或移除。 */
  const enqueuePreset = (task) => {
    // 串行化由 runtime 负责，这里只补日志（PRESET 写配置不能并发）。
    return RUNTIME.enqueuePresetWrite(task).catch((error) => {
      const logger = ctx.logger
      if (typeof logger?.warn === 'function') logger.warn(`agent-embodiment: preset task failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 启动时检测：preset 里没有控制行且未被手动停用 → 自动补挂。 */
  function autoMountControl() {
    if (!getAutoMountControl()) return
    const editor = RUNTIME.getConfigEditor()
    const entry = findKnownPresetEntry()
    if (!editor || typeof editor.edit !== 'function' || !entry) {
      if (editor && typeof editor.edit === 'function' && !entry) presetWarn('auto-mount skipped: no known agent preset id')
      return
    }
    if (presetMountState(entry).presetMounted) return
    void editor
      .edit(entry, (current) => mutatePreset(current, true))
      .then(() => verifyPresetMount(true, 'auto-mount'))
      .catch((error) => {
        presetWarn(`auto-mount failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  const presetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    const editor = RUNTIME.getConfigEditor()
    const entry = findKnownPresetEntry() || findPresetEntry()
    if (!editor || typeof editor.edit !== 'function' || !entry) {
      return send(501, { ok: false, error: 'agent preset is not editable in this profile' })
    }
    readJson(request, response, (input) => {
      if (typeof input?.enable !== 'boolean') return send(400, { ok: false, error: 'enable must be a boolean' })
      if (input.enable && !findKnownPresetEntry()) {
        return send(409, { ok: false, error: 'no known agent preset id; open Settings → Agent presets and add the control row manually' })
      }
      send(202, { ok: true, accepted: { enable: input.enable } })
      if (input.enable) {
        setAutoMountControl(true)
        saveSessionToggles()
        enqueuePreset(async () => {
          const ed = RUNTIME.getConfigEditor()
          const target = findKnownPresetEntry()
          if (ed && typeof ed.edit === 'function' && target) {
            await ed.edit(target, (current) => mutatePreset(current, true))
            verifyPresetMount(true, 'enable')
          }
        })
      } else {
        setAutoMountControl(false)
        saveSessionToggles()
        enqueuePreset(async () => {
          const ed = RUNTIME.getConfigEditor()
          const target = findKnownPresetEntry() || findPresetEntry()
          if (ed && typeof ed.edit === 'function' && target) {
            await ed.edit(target, (current) => mutatePreset(current, false))
            verifyPresetMount(false, 'disable')
          }
        })
      }
    })
  }

  // 浏览器半侧（client.js）通过这个只读接口取上下文与最近测量值。
  // 用 ctx.inject(['webServer']) 而不是写进 export const inject：
  // 无 Web server 的 profile（纯 CLI/headless）也能正常挂载本插件。
  ctx.inject(['sessionQuery'], (sub) => {
    RUNTIME.setSessionQuery(sub?.sessionQuery ?? null)
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setSessionQuery(null) }, 'agent-embodiment: sessionQuery presence')
  })

  // 带超时的读取：超时通过 AbortSignal 一并取消底层读取，避免只丢弃结果而让会话观察继续运行。
  const readWithTimeout = async (call, ms, label) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms`)), ms)
    if (typeof timer?.unref === 'function') timer.unref()
    try {
      return await Promise.race([
        call(controller.signal),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  const mapLimit = async (items, limit, worker) => {
    const output = Array.from({ length: items.length })
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

  // 会话日志折叠很便宜但文件读取不便宜；按 sessionId 做 TTL 缓存，页面切 tab/刷新不会反复读全量。
  // 非活跃会话用 60s（回看历史的场景多），活跃会话仍由调用方传 3s 以保持数字跟手。
  const foldCache = new Map()
  const FOLD_CACHE_MAX = 60
  const FOLD_CACHE_TTL_MS = 60000
  // 跨会话分析编排（含 (range,limit) 短 TTL 缓存）在 analytics.js；这里只注入依赖。
  const ANALYTICS = createAnalytics({
    getSessionQuery: () => RUNTIME.getSessionQuery(),
    foldFor: (sessionId, header, ttlMs) => observeFold(sessionId, header, ttlMs),
    summarizeFolds,
    readCompactionLog: () => listCompactionLog(),
    getPricing: () => effectivePricing,
    getLimit: () => config.analyticsLimit,
    readWithTimeout,
    mapLimit,
  })
  const analyticsPayload = (url) => ANALYTICS.payload(url)

  const observeFold = async (sessionId, header, ttlMs = FOLD_CACHE_TTL_MS) => {
    const cached = foldCache.get(sessionId)
    if (cached && Date.now() - cached.at < ttlMs) return cached.fold
    if (!RUNTIME.getSessionQuery() || typeof RUNTIME.getSessionQuery().observeSession !== 'function') throw new Error('sessionQuery.observeSession unavailable')
    const observation = await readWithTimeout((signal) => RUNTIME.getSessionQuery().observeSession(sessionId, { projectionMode: 'none', signal }), 4000, 'observeSession')
    try {
      const fold = foldSession(observation.header ?? header, observation.events ?? [], effectivePricing)
      foldCache.delete(sessionId)
      foldCache.set(sessionId, { at: Date.now(), fold })
      while (foldCache.size > FOLD_CACHE_MAX) foldCache.delete(foldCache.keys().next().value)
      return fold
    } finally {
      const dispose = typeof observation[Symbol.dispose] === 'function' ? observation[Symbol.dispose] : null
      if (dispose) dispose.call(observation)
    }
  }

  /** GET /status/analytics?range=7d|30d|all|today&limit=40 —— 近 N 个会话的聚合。 */
  const analyticsHandler = async (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    try {
      return send(200, await analyticsPayload(requestUrl(request)))
    } catch (error) {
      return send(error?.statusCode || 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** GET /status/session-detail?sessionId=... —— 当前会话的请求序列 + 事件。 */
  const sessionDetailHandler = async (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    if (!RUNTIME.getSessionQuery() || typeof RUNTIME.getSessionQuery().observeSession !== 'function') {
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


  // /status 会被面板与 dock 在同一个刷新周期里各拉一次；序列化整个 measurements + 日志
  // 有成本，这里做短缓存。但**写入后必须立即可见**，所以缓存同时绑定修订号：
  // 任何会改变 payload 的写入（测量、压缩日志、引导状态）都递增修订号，命中条件才成立。
  const STATUS_CACHE_MS = 800
  const bumpStatusRevision = () => {
    RUNTIME.bumpStatusRevision()
  }
  // 所有写操作前自动备份（profile patch 与状态文件），保留最近 30 份；实现见状态目录初始化处。

  // 可写配置：宿主平面有 configEditor 服务时（Web/Desktop profile 都有），
  // 面板可以把上下文/阈值写回 profile 的 patch 层，写完后 Loader 会按新配置重挂本插件。
  ctx.inject(['configEditor'], (sub) => {
    RUNTIME.setConfigEditor(sub?.configEditor ?? null)
    // 记录被替换的原方法，dispose 时还原——否则这个猴子补丁会一直留在共享服务上，
    // 插件卸载/重挂后仍然给每次 edit 多做一次备份。
    let restoreEdit = null
    try {
      const editor = RUNTIME.getConfigEditor()
      if (editor && typeof editor.edit === 'function' && !editor.__ctxBackedUp) {
        const originalEdit = editor.edit.bind(editor)
        editor.edit = (...args) => {
          try {
            const patchPath = typeof editor.documentPath === 'string' ? editor.documentPath : null
            backupFile(patchPath, 'cordis.patch')
          } catch {}
          return originalEdit(...args)
        }
        editor.__ctxBackedUp = true
        restoreEdit = () => {
          try {
            editor.edit = originalEdit
            delete editor.__ctxBackedUp
          } catch {}
        }
      }
    } catch {}
    setTimeout(() => {
      try {
        autoMountControl()
      } catch {}
    }, 1200)
    if (typeof sub.effect === 'function') {
      sub.effect(() => () => {
        if (restoreEdit) restoreEdit()
        RUNTIME.setConfigEditor(null)
      }, 'agent-embodiment: config editor presence')
    }
  })

  /** 校验来自浏览器面板的配置补丁；不合法返回 null。 */
  const parseConfigPatch = (input) => {
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
    if (input.compressionStrategy !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(COMPRESSION_STRATEGIES, input.compressionStrategy)) return null
      const preset = COMPRESSION_STRATEGIES[input.compressionStrategy]
      patch.compressionStrategy = input.compressionStrategy
      if (input.triggerAt === undefined) ratios.triggerAt = preset.triggerAt
      if (input.targetAt === undefined) ratios.targetAt = preset.targetAt
      if (input.keepTokens === undefined) {
        const budget = input.contextWindowTokens ?? config.contextWindowTokens
        patch.keepTokens = input.compressionStrategy === 'balanced' ? 0 : Math.max(0, Math.round(budget * preset.keepRatio))
      }
    }
    if (input.analyticsLimit !== undefined) {
      if (!Number.isInteger(input.analyticsLimit) || input.analyticsLimit < 1 || input.analyticsLimit > 200) return null
      patch.analyticsLimit = input.analyticsLimit
    }
    if (input.autoMountControl !== undefined) {
      if (typeof input.autoMountControl !== 'boolean') return null
      patch.autoMountControl = input.autoMountControl
    }
    if (input.modelPricing !== undefined) {
      if (!Array.isArray(input.modelPricing) || input.modelPricing.length > 50) return null
      const rows = []
      for (const row of input.modelPricing) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return null
        if (typeof row.match !== 'string' || row.match.trim() === '' || row.match.length > 200) return null
        try {
          new RegExp(row.match, 'i')
        } catch {
          return null
        }
        const numbers = ['input', 'cacheRead', 'cacheWrite', 'output'].map((key) => row[key] === undefined ? 0 : row[key])
        if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null
        // 峰谷两档：给了就带上，字段缺省回落平档；校验规则与 Config schema 一致。
        const band = (value) => {
          if (value === undefined) return null
          if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid'
          const bandNumbers = ['input', 'cacheRead', 'cacheWrite', 'output'].map((key) => value[key] === undefined ? 0 : value[key])
          if (bandNumbers.some((item) => typeof item !== 'number' || !Number.isFinite(item) || item < 0)) return 'invalid'
          if (typeof value.input !== 'number' || typeof value.output !== 'number') return 'invalid'
          return { input: bandNumbers[0], cacheRead: bandNumbers[1], cacheWrite: bandNumbers[2], output: bandNumbers[3] }
        }
        const peak = band(row.peak)
        const offPeak = band(row.offPeak)
        if (peak === 'invalid' || offPeak === 'invalid') return null
        rows.push({
          match: row.match.trim(),
          input: numbers[0],
          cacheRead: numbers[1],
          cacheWrite: numbers[2],
          output: numbers[3],
          ...(peak ? { peak } : {}),
          ...(offPeak ? { offPeak } : {}),
        })
      }
      patch.modelPricing = rows
    }
    if (input.holidays !== undefined) {
      if (!Array.isArray(input.holidays) || input.holidays.length > 400) return null
      const dates = input.holidays.map((value) => (typeof value === 'string' ? value.trim() : value))
      if (!dates.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value))) return null
      patch.holidays = [...new Set(dates)].sort()
    }
    if (input.holidaysIgnoreBuiltin !== undefined) {
      if (typeof input.holidaysIgnoreBuiltin !== 'boolean') return null
      patch.holidaysIgnoreBuiltin = input.holidaysIgnoreBuiltin
    }
    const warn = ratios.warnAt ?? config.warnAt
    const error = ratios.errorAt ?? config.errorAt
    const trigger = ratios.triggerAt ?? config.triggerAt
    const target = ratios.targetAt ?? config.targetAt
    if (!(warn < error)) return null
    if (!(target < trigger)) return null
    return { ...patch, ...ratios }
  }

  /** POST 配置：先 202 应答，再在后台让 configEditor 落盘并重挂（重挂会销毁本路由）。 */
  const configHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    const editor = RUNTIME.getConfigEditor()
    if (!editor || typeof editor.edit !== 'function' || typeof editor.entries !== 'function') {
      return send(501, { ok: false, error: 'config editor unavailable in this profile' })
    }
    // 配置补丁限制 16KB：超限 413 并断开，避免面板误发大对象。
    readJson(request, response, (input) => {
      const patch = parseConfigPatch(input)
      if (patch === null) return send(400, { ok: false, error: 'invalid config patch' })
      const entry = editor.entries().find((candidate) => candidate?.options?.id === 'agent-embodiment')
      if (!entry) return send(409, { ok: false, error: 'plugin entry is not editable in the active profile' })
      send(202, { ok: true, accepted: patch })
      // 落盘会触发重挂，本插件的旧实例（包括这条路由）随即被销毁。
      void editor
        .edit(entry, (current) => ({ ...(current ?? {}), ...patch }))
        .catch((error) => {
          const logger = ctx.logger
          if (typeof logger?.warn === 'function') logger.warn(`agent-embodiment: config write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    }, 16 * 1024, 'invalid config patch')
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
        'agent-embodiment: global tool restriction',
      )
    } else install()
  })

  /** 最近一个会话（与 /live 同一口径）。 */
  const latestSession = () => {
    if (!RUNTIME.getSessions() || typeof RUNTIME.getSessions().list !== 'function') return undefined
    return sessionsNewestFirst(RUNTIME.getSessions().list())[0]
  }

  /**
   * 把当前运行时的全局/会话覆盖叠到最近一次请求的旧快照上。
   * 否则改完提示词、还没发下一条消息时，面板仍会拿旧快照判断“有没有覆盖”，
   * 导致“保存到本会话”后复位按钮走了全局复位（删掉全局覆盖）。
   */
  /** GET 当前会话的工具/提示词清单与开关状态。 */
  /** GET /status/insights：把分析结果折成可执行结论；文案由客户端本地化。 */
  const insightsHandler = async (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    try {
      const url = requestUrl(request)
      const analytics = await analyticsPayload(url)
      const requested = url.searchParams.get('sessionId') ?? ''
      const session = requested && RUNTIME.getSessions() && typeof RUNTIME.getSessions().get === 'function' ? RUNTIME.getSessions().get(requested) : latestSession()
      const sessionId = requested || session?.id || null
      const found = sessionId ? getInventory(sessionId) : null
      const inventory = found ? { ...withLivePromptState(found, sessionId), sources: sourcesFor(found) } : null
      return send(200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        insights: buildInsights({
          analytics,
          latest: [...measurements.values()].reverse()[0] ?? null,
          inventory,
          toolUsage: analytics.toolUsage,
          logs: listCompactionLog(),
          pricing: {
            custom: Array.isArray(config.modelPricing) && config.modelPricing.length > 0,
            updatedAt: PRICING_UPDATED_AT,
          },
          onboarding,
          budget: { tokens: config.contextWindowTokens },
        }),
      })
    } catch (error) {
      return send(error?.statusCode || 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** POST /status/onboarding：记录首次运行是否完成/跳过/授权；reset:true 时清除所有状态以重新显示。 */
  const onboardingHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      if (input && input.reset === true) {
        Object.assign(onboarding, {
          completed: false,
          dismissed: false,
          deferredAt: null,
          budgetConfirmed: false,
          budgetTokens: config.contextWindowTokens,
          presetConsent: null,
          at: new Date().toISOString(),
          version: PLUGIN_VERSION,
        })
        saveOnboarding()
        return send(202, { ok: true, onboarding })
      }
      const patch = {}
      if (input && typeof input.completed === 'boolean') patch.completed = input.completed
      if (input && typeof input.dismissed === 'boolean') patch.dismissed = input.dismissed
      // “稍后”：写入 deferredAt 而非 dismissed，避免永久关闭。
      if (input && input.deferred === true) {
        patch.deferredAt = new Date().toISOString()
        patch.dismissed = false
      }
      if (input && typeof input.budgetConfirmed === 'boolean') patch.budgetConfirmed = input.budgetConfirmed
      if (input && typeof input.presetConsent === 'boolean') patch.presetConsent = input.presetConsent
      if (input && Number.isInteger(input.budgetTokens) && input.budgetTokens > 0) patch.budgetTokens = input.budgetTokens
      Object.assign(onboarding, {
        ...onboarding,
        ...patch,
        version: PLUGIN_VERSION,
        at: new Date().toISOString(),
  })
      saveOnboarding()
      return send(202, { ok: true, onboarding })
    })
  }

  /**
   * POST /status/session-budget {sessionId, tokens}：面板里设置/清除单个会话的预算覆盖，
   * 等价于在会话里执行 `/embody <tokens>` / `/embody reset`。tokens 传 null 或 0 表示清除。
   */
  /** GET /status/export?format=json|csv：导出当前扫描范围的分析结果。 */
  /** POST /status/data/reset：清空压缩日志和/或会话开关；不删除 profile 配置。 */
  /** POST /inventory/toggle {kind, name, layer, enabled}。 */
  /** POST /inventory/reset {layer:'session'}：清空当前会话的全部开关。 */
  // 全局工具禁用也维护一份运行时副本：配置写入是异步的，连续切换时若每次都读
  // 本插件实例的 config 快照，后一次会把前一次刚加的禁用项覆盖掉。

  // 串行化 profile 写入：连续点两次“保存”时，后一次必须覆盖前一次，
  // 而不是两个异步 edit 互相覆盖。每次真正落盘时都读当前运行时状态。
  const queuePromptWrite = (task) => RUNTIME.enqueuePromptWrite(task)

  /** 把 extraPrompts / placements 写回 profile config；运行时先同步，避免等待重挂。 */
  const writeExtraPrompts = (next, placements, response, send) => {
    const editor = RUNTIME.getConfigEditor()
    const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'agent-embodiment') : undefined
    if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
    RUNTIME.setExtraPrompts(next)
    RUNTIME.setExtraPromptPlacements(placements)
    setGlobalExtraPrompts(RUNTIME.getExtraPrompts())
    setGlobalExtraPromptPlacements(RUNTIME.getExtraPromptPlacements())
    send(202, { ok: true, accepted: RUNTIME.getExtraPrompts(), placements: RUNTIME.getExtraPromptPlacements() })
    void queuePromptWrite(() => editor.edit(entry, (value) => ({
      ...(value ?? {}),
      extraPrompts: RUNTIME.getExtraPrompts(),
      extraPromptPlacements: RUNTIME.getExtraPromptPlacements(),
    })))
      .catch(() => {})
  }

  /** POST /inventory/extra-prompt {name, text}：新增或更新一条额外 system section。 */
  /** POST /inventory/extra-prompt/reset {name?}：移除一条或全部额外 system section。 */
  /** 把 promptOverrides 写回 profile config。 */
  const writePromptOverrides = (next, response, send) => {
    const editor = RUNTIME.getConfigEditor()
    const entry = editor && typeof editor.entries === 'function' ? editor.entries().find((candidate) => candidate?.options?.id === 'agent-embodiment') : undefined
    if (!editor || typeof editor.edit !== 'function' || !entry) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
    RUNTIME.setPromptOverrides(next)
    setGlobalPromptOverrides(RUNTIME.getPromptOverrides())
    send(202, { ok: true, accepted: RUNTIME.getPromptOverrides() })
    void queuePromptWrite(() => editor.edit(entry, (value) => ({
      ...(value ?? {}),
      promptOverrides: RUNTIME.getPromptOverrides(),
    })))
      .catch(() => {})
  }

  /** POST /inventory/prompt {name, text}：全局覆盖一个提示词 section。 */
  /** POST /inventory/prompt/reset {name?}：恢复一个或全部提示词原文。 */
  /** 会话级提示词文本覆盖：POST /inventory/prompt/session {name, text, sessionId?}。 */
  /** 清除会话级提示词文本覆盖：POST /inventory/prompt/session/reset {name?, sessionId?}。 */
  // ── Agent Embodiment Scaffold：三条路由已抽到 routes-scaffold.js（0.36.0）──
  // 依赖显式注入，因此可以用假 request/response 直接单测，不需要构造 Cordis 上下文。
  // ── 技能读取（只读）：宿主 skills 注册表可能缺席，缺席时路由返回 503 ──
  ctx.inject(['skills'], (sub) => {
    RUNTIME.setSkills(sub?.skills ?? null)
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setSkills(null) }, 'agent-embodiment: skills presence')
  })

  const { skillsHandler, skillBodyHandler } = createSkillRoutes({
    jsonSender,
    requireMethod,
    requestUrl,
    getSkills: () => RUNTIME.getSkills(),
    // 技能作用域由控制半侧（preset 平面）探测后写入共享状态；没有就传 undefined，行为退回只读全局层。
    getScopeKey: () => getSkillsScope(),
    getCwdForSession: (sessionId) => {
      const sessions = RUNTIME.getSessions()
      if (!sessions || typeof sessions.get !== 'function') return null
      const record = sessions.get(sessionId)
      const header = record?.header ?? record?.session?.header ?? record
      return typeof header?.cwd === 'string' && header.cwd.length > 0 ? header.cwd : null
    },
    defaultCwd: () => process.cwd(),
    // 注册表在全局层读不到 preset 作用域的 provider（ScopeKey 是 dsh-scope 的私有
    // Symbol），所以空目录时按标准根目录兜底扫描；这两个 home 与宿主 provider 一致。
    resolveHomes: () => ({
      dshHome: RUNTIME.paths.dshHome,
      agentsHome: process.env.DSH_AGENTS_HOME && process.env.DSH_AGENTS_HOME.length > 0
        ? process.env.DSH_AGENTS_HOME
        : join(RUNTIME.paths.home, '.agents'),
    }),
    logger: (level, message) => {
      const logger = ctx.logger
      const target = level === 'warn' ? 'warn' : 'info'
      if (typeof logger?.[target] === 'function') logger[target](`agent-embodiment: ${message}`)
    },
  })

  const { scaffoldTemplateList, scaffoldPreviewHandler, scaffoldGenerateHandler } = createScaffoldRoutes({
    home: STATE_ROOTS.home,
    dshHome: STATE_ROOTS.dshHome,
    jsonSender,
    requireMethod,
    readJson,
  })

  // ── 会话预算 / 数据清理 / 会话提示词 / 新增提示词：已抽到 routes-session.js（0.37.0）──
  const {
    sessionBudgetHandler,
    dataResetHandler,
    sessionPromptHandler,
    sessionPromptResetHandler,
    extraPromptHandler,
    extraPromptResetHandler,
  } = createSessionRoutes({
    jsonSender,
    requireMethod,
    readJson,
    bumpStatusRevision,
    latestSessionId: () => latestSession()?.id,
    setSessionBudget,
    clearSessionBudget,
    listSessionBudgets,
    hydrateCompactionLog,
    compactionLogPath: COMPACTION_LOG_PATH,
    atomicWriteFile,
    clearAllSessionToggles,
    saveSessionToggles,
    setSessionPromptText,
    clearSessionPromptText,
    getExtraPrompts: () => RUNTIME.getExtraPrompts(),
    getExtraPromptPlacements: () => RUNTIME.getExtraPromptPlacements(),
    writeExtraPrompts,
  })

  // ── 状态读取三条路由已抽到 routes-status.js（0.40.0）──
  const {
    statusHandler,
    liveHandler,
    exportHandler,
  } = createStatusRoutes({
    runtime: RUNTIME,
    getConfig: () => config,
    getMeasurements: () => measurements,
    controlSnapshot,
    getCompacting: () => controlState.compacting,
    measure: (session) => ctx.tokenMeter.measure(session),
    budgetFor,
    breakdownOf,
    requestUrl,
    jsonSender,
    sendJson,
    requireMethod,
    sessionsNewestFirst,
    analyticsPayload,
    buildHealth,
    holidayInfo,
    beijingYear,
    isPeakTime,
    listSessionBudgets,
    getControlBudget,
    csvCell,
    csvDocument,
    statusCacheMs: STATUS_CACHE_MS,
    constants: {
      version: PLUGIN_VERSION,
      compatibility: COMPATIBILITY,
      pricingCurrency: PRICING_CURRENCY,
      pricingSource: PRICING_SOURCE,
      pricingUpdatedAt: PRICING_UPDATED_AT,
      pricingMeta: PRICING_META,
    },
  })

  // ── inventory 路由组已抽到 routes-inventory.js（0.43.0）──
  const {
    inventoryHandler,
    inventoryToggleHandler,
    inventoryResetHandler,
    promptEditHandler,
    promptResetHandler,
    withLivePromptState,
  } = createInventoryRoutes({
    jsonSender,
    requireMethod,
    readJson,
    requestUrl,
    runtime: RUNTIME,
    latestSessionId: () => latestSession()?.id,
    getInventory,
    sourcesFor,
    getSessionPromptTextMap,
    getSessionDisabledTools,
    getSessionDisabledPrompts,
    getAppliedTools,
    setSessionToolEnabled,
    setSessionPromptEnabled,
    clearSessionToggles,
    saveSessionToggles,
    setGlobalDisabledTools,
    setGlobalPromptOverrides,
    setGlobalExtraPrompts,
    setGlobalExtraPromptPlacements,
    queuePromptWrite,
    writePromptOverrides,
    promptTemplates: PROMPT_TEMPLATES,
    log: (level, message) => {
      const logger = ctx.logger
      const target = level === 'warn' ? 'warn' : 'info'
      if (typeof logger?.[target] === 'function') logger[target](`agent-embodiment: ${message}`)
    },
  })

  ctx.inject(['webServer'], (sub) => {
    const server = sub?.webServer
    if (!server || typeof server.register !== 'function') return
    // 有 webServer 就说明这是浏览器形态：此时若没有 connection 服务，
    // 请求无法做 Host/Origin/cookie 校验，状态路由必须失败关闭（见 requestRejection）。
    RUNTIME.setWebServerPresent(true)
    const register = () => {
      const offs = [
        server.register({ kind: 'exact', path: STATUS_PATH, handler: authed(statusHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/config`, handler: authed(configHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/live`, handler: authed(liveHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/analytics`, handler: authed(analyticsHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/insights`, handler: authed(insightsHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/onboarding`, handler: authed(onboardingHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/session-budget`, handler: authed(sessionBudgetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/export`, handler: authed(exportHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/data/reset`, handler: authed(dataResetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/session-detail`, handler: authed(sessionDetailHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/config/preset`, handler: authed(presetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory`, handler: authed(inventoryHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/toggle`, handler: authed(inventoryToggleHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/reset`, handler: authed(inventoryResetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt`, handler: authed(promptEditHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/reset`, handler: authed(promptResetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session`, handler: authed(sessionPromptHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/prompt/session/reset`, handler: authed(sessionPromptResetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/extra-prompt`, handler: authed(extraPromptHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/inventory/extra-prompt/reset`, handler: authed(extraPromptResetHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/skills`, handler: authed(skillsHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/skills/body`, handler: authed(skillBodyHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/scaffold/templates`, handler: authed(scaffoldTemplateList) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/scaffold/preview`, handler: authed(scaffoldPreviewHandler) }),
        server.register({ kind: 'exact', path: `${STATUS_PATH}/scaffold/generate`, handler: authed(scaffoldGenerateHandler) }),
      ]
      return () => offs.forEach((off) => off())
    }
    if (typeof sub.effect === 'function') sub.effect(register, 'agent-embodiment: routes')
    else register()
    if (typeof sub.effect === 'function') sub.effect(() => () => { RUNTIME.setWebServerPresent(false) }, 'agent-embodiment: webServer presence')
  })

  // 注意：本文件是宿主半侧，只读测量、不改会话历史。真正的「控制」在
  // control.js：它必须挂在 agent preset 的 compaction 组里，才能看到
  // ctx.compaction 并调用 compactNow / compactIfNeeded。
}
