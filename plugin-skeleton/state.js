/**
 * state.js — 两个半侧之间唯一的内存状态（进程内，重启即清空）。
 *
 * 为什么要有它：宿主半侧（index.js）负责「设置」，控制半侧（control.js）负责
 * 「到点自动压缩」，两者在 Web 形态下被 Cordis 的 realm 隔离分开（一个在宿主树，
 * 一个在 agent preset 的 isolate 组里）。它们不能互相 import 对方的服务，但
 * `./state.js` 是同一个包里的同一个模块 —— ESM 按文件 URL 缓存，只要两行解析到
 * 同一个包目录，拿到的就是同一份状态。
 *
 * 约定：
 *   - defaultBudget       全局默认预算（来自宿主半侧的 Config.contextWindowTokens）
 *   - overrides           按 session id 的临时覆盖（/ctx <tokens> 写入，重启失效）
 *   - control             控制半侧的运行状态（面板只读）
 * 所有导出都是小函数，不依赖 Cordis，方便测试直接 import。
 */

/** 最多保留多少个会话的覆盖，防止长期运行无限增长。 */
const MAX_OVERRIDES = 200

/** 全局默认预算（token）；宿主半侧 apply 时写入。 */
let defaultBudget

/** 自动压缩触发比例（0–1；1 = 到上下限才触发）；宿主半侧 apply 时写入。 */
let defaultTriggerAt = 1

/** 自动压缩的目标比例（0–1；压到该比例以下就停）；宿主半侧 apply 时写入。 */
let defaultTargetAt = 0.6

/** 压缩时保留的最近 tokens（0 = 用预算 25%）；宿主半侧 apply 时写入。 */
let defaultKeepTokens = 0

/** sessionId -> token 预算 */
const overrides = new Map()

/** 控制半侧最近的运行状态，供宿主面板展示。 */
export const control = {
  /** 控制半侧是否已激活（挂在能看到 compaction 服务的位置）。 */
  active: false,
  /** 当前生效的触发模式：off / notify / idle / pre-step。 */
  mode: null,
  /** 最近一次自动压缩的 session id。 */
  sessionId: null,
  /** 最近一次自动压缩的时间（ISO 字符串）。 */
  at: null,
  /** 最近一次自动压缩的结果：{ before, after, shadowed }。 */
  last: null,
  /** 最近一次自动压缩失败的原因（null 表示无）。 */
  lastError: null,
  /** 当前是否正在执行压缩（面板据此显示“压缩中”）。 */
  compacting: false,
}

/** 宿主半侧写入全局默认预算。 */
export function setDefaultBudget(tokens) {
  defaultBudget = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : undefined
}

/** 读取全局默认预算（可能为 undefined）。 */
export function getDefaultBudget() {
  return defaultBudget
}

/** 宿主半侧写入自动压缩触发比例（非法值忽略，保持默认 1）。 */
export function setDefaultTriggerAt(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0 && number <= 1) defaultTriggerAt = number
}

/** 读取自动压缩触发比例（默认 1）。 */
export function getDefaultTriggerAt() {
  return defaultTriggerAt
}

/** 宿主半侧写入压缩目标比例（非法值忽略，保持默认 0.6）。 */
export function setDefaultTargetAt(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0 && number < 1) defaultTargetAt = number
}

/** 读取压缩目标比例（默认 0.6）。 */
export function getDefaultTargetAt() {
  return defaultTargetAt
}

/** 宿主半侧写入压缩保留量（0 或非法值保持自动 25%）。 */
export function setDefaultKeepTokens(value) {
  const number = Number(value)
  if (Number.isInteger(number) && number >= 0) defaultKeepTokens = number
}

/** 读取压缩保留量（0 = 自动 25%）。 */
export function getDefaultKeepTokens() {
  return defaultKeepTokens
}

/** 控制半侧标记/清除“压缩中”状态。 */
export function setCompacting(value) {
  control.compacting = Boolean(value)
}

/** 写入某个会话的临时预算覆盖。 */
export function setSessionBudget(sessionId, tokens) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return false
  overrides.delete(sessionId)
  overrides.set(sessionId, tokens)
  while (overrides.size > MAX_OVERRIDES) overrides.delete(overrides.keys().next().value)
  return true
}

/** 清除某个会话的临时覆盖；返回是否真的清掉了。 */
export function clearSessionBudget(sessionId) {
  return overrides.delete(sessionId)
}

/** 读取某个会话的临时覆盖（没有则 undefined）。 */
export function getSessionBudget(sessionId) {
  return overrides.get(sessionId)
}

/** 列出全部会话覆盖（面板展示用）。 */
export function listSessionBudgets() {
  return [...overrides.entries()].map(([sessionId, tokens]) => ({ sessionId, tokens }))
}

/**
 * 计算某会话的实际预算：会话覆盖 > 全局默认 > fallback（控制行自己的配置）。
 * @param {string | undefined} sessionId 会话 id
 * @param {number} fallback 兜底值（通常来自 control.js 的 Config.maxContextTokens）
 * @returns {number} 实际预算（正整数）
 */
export function budgetFor(sessionId, fallback) {
  const override = typeof sessionId === 'string' ? overrides.get(sessionId) : undefined
  if (typeof override === 'number') return override
  if (typeof defaultBudget === 'number') return defaultBudget
  return typeof fallback === 'number' && fallback > 0 ? fallback : 100000
}

/** 控制半侧记录一次自动/手动压缩的结果。 */
export function recordCompaction(sessionId, before, after, shadowed) {
  control.sessionId = typeof sessionId === 'string' ? sessionId : null
  control.at = new Date().toISOString()
  control.last = { before, after, shadowed }
}

// ── 压缩记录（成功 / 失败）：内存环形缓冲 + 宿主半侧落盘 ──────────────────
//
// 控制半侧在压缩发生时调用 recordCompactionEvent；宿主半侧（index.js）订阅
// 同一份状态并追加到 ~/.dsh/ctx-mon-and-con/compaction-log.jsonl，面板从
// status 接口读取最近 50 条。持久化放在宿主半侧，测试 import state.js 时不会写盘。

/** 内存里最多保留多少条压缩记录（面板只展示最近 50 条）。 */
const COMPACTION_LOG_MAX = 200

/** 压缩记录（按时间正序，最新在末尾）。 */
const compactionLog = []

/** 订阅压缩记录写入（宿主半侧用来落盘）。 */
const compactionLogListeners = new Set()

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const integerOrNull = (value) => (Number.isInteger(value) && value >= 0 ? value : null)

/** 记录一条压缩结果（成功或失败），返回写入的条目。 */
export function recordCompactionEvent(event) {
  const source = event && typeof event === 'object' ? event : {}
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    outcome: source.outcome === 'failure' ? 'failure' : 'success',
    trigger: typeof source.trigger === 'string' && source.trigger.length > 0 ? source.trigger : null,
    sessionId: typeof source.sessionId === 'string' && source.sessionId.length > 0 ? source.sessionId : null,
    before: numberOrNull(source.before),
    after: numberOrNull(source.after),
    budget: numberOrNull(source.budget),
    target: numberOrNull(source.target),
    durationMs: numberOrNull(source.durationMs),
    rounds: integerOrNull(source.rounds),
    shadowed: numberOrNull(source.shadowed),
    message: typeof source.message === 'string' && source.message.length > 0 ? source.message : null,
  }
  compactionLog.push(entry)
  while (compactionLog.length > COMPACTION_LOG_MAX) compactionLog.shift()
  for (const listener of compactionLogListeners) {
    try {
      listener(entry)
    } catch {}
  }
  return entry
}

/** 列出内存中的压缩记录（按时间正序）。 */
export function listCompactionLog() {
  return compactionLog.slice()
}

/** 宿主半侧启动时从磁盘回填（按时间正序的 JSON 对象数组）。 */
export function hydrateCompactionLog(entries) {
  compactionLog.length = 0
  if (!Array.isArray(entries)) return
  for (const entry of entries.slice(-COMPACTION_LOG_MAX)) {
    if (!entry || typeof entry !== 'object') continue
    compactionLog.push({
      id: typeof entry.id === 'string' ? entry.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: typeof entry.at === 'string' ? entry.at : new Date().toISOString(),
      outcome: entry.outcome === 'failure' ? 'failure' : 'success',
      trigger: typeof entry.trigger === 'string' && entry.trigger.length > 0 ? entry.trigger : null,
      sessionId: typeof entry.sessionId === 'string' && entry.sessionId.length > 0 ? entry.sessionId : null,
      before: numberOrNull(entry.before),
      after: numberOrNull(entry.after),
      budget: numberOrNull(entry.budget),
      target: numberOrNull(entry.target),
      durationMs: numberOrNull(entry.durationMs),
      rounds: integerOrNull(entry.rounds),
      shadowed: numberOrNull(entry.shadowed),
      message: typeof entry.message === 'string' && entry.message.length > 0 ? entry.message : null,
    })
  }
}

/** 订阅压缩记录写入；返回取消订阅函数。 */
export function subscribeCompactionLog(listener) {
  if (typeof listener !== 'function') return () => {}
  compactionLogListeners.add(listener)
  return () => compactionLogListeners.delete(listener)
}

/** 控制半侧激活/卸载时更新状态。 */
export function setControlActive(active, mode) {
  control.active = Boolean(active)
  control.mode = active ? (mode ?? null) : null
  if (!active) control.compacting = false
}

// ── 工具 / 提示词开关（当前会话，内存态；重启清空） ────────────────────────

/** sessionId -> Set(tool name) */
const sessionTools = new Map()
/** sessionId -> Set(prompt section name) */
const sessionPrompts = new Map()
/** sessionId -> 最近一次请求装配后的清单 */
const inventories = new Map()
/** sessionId -> 最近一次实际应用的工具黑名单 */
const applied = new Map()

function toggleSet(map, sessionId, name, enabled) {
  let set = map.get(sessionId)
  if (!set) {
    set = new Set()
    map.set(sessionId, set)
  }
  if (enabled) set.delete(name)
  else set.add(name)
  if (set.size === 0) map.delete(sessionId)
}

export function setSessionToolEnabled(sessionId, name, enabled) {
  toggleSet(sessionTools, sessionId, name, enabled)
}

export function setSessionPromptEnabled(sessionId, name, enabled) {
  toggleSet(sessionPrompts, sessionId, name, enabled)
}

export function getSessionDisabledTools(sessionId) {
  return [...(sessionTools.get(sessionId) ?? [])]
}

export function getSessionDisabledPrompts(sessionId) {
  return [...(sessionPrompts.get(sessionId) ?? [])]
}

export function clearSessionToggles(sessionId) {
  sessionTools.delete(sessionId)
  sessionPrompts.delete(sessionId)
}

export function recordInventory(sessionId, inventory) {
  inventories.set(sessionId, { at: new Date().toISOString(), ...inventory })
}

export function getInventory(sessionId) {
  return inventories.get(sessionId) ?? null
}

export function recordAppliedTools(sessionId, deny) {
  applied.set(sessionId, { at: new Date().toISOString(), deny: [...deny] })
}

const syncDebug = new Map()
export function recordSyncDebug(sessionId, entry) {
  syncDebug.set(sessionId, { at: new Date().toISOString(), ...entry })
}
export function getSyncDebug(sessionId) {
  return syncDebug.get(sessionId) ?? null
}
export function getAppliedTools(sessionId) {
  return applied.get(sessionId) ?? null
}
/** 全局提示词覆盖（section name -> 文本），宿主半侧从 Config 同步过来。 */
let globalPromptOverrides = {}

export function setGlobalPromptOverrides(value) {
  globalPromptOverrides = value && typeof value === 'object' ? { ...value } : {}
}

export function getGlobalPromptOverrides() {
  return globalPromptOverrides
}

/** 全局新增提示词（用户命名 -> 文本）；与覆盖不同，它创建新的 system section。 */
let globalExtraPrompts = {}

export function setGlobalExtraPrompts(value) {
  globalExtraPrompts = value && typeof value === 'object' ? { ...value } : {}
}

export function getGlobalExtraPrompts() {
  return globalExtraPrompts
}

/** 全局禁用的工具名（Config.disabledTools，宿主 apply 时同步）。 */
let globalDisabledTools = []

export function setGlobalDisabledTools(value) {
  globalDisabledTools = Array.isArray(value) ? [...value] : []
}

export function getGlobalDisabledTools() {
  return globalDisabledTools
}

/** 会话开关持久化：导出为纯 JSON。 */
export function snapshotSessionToggles() {
  const tools = {}
  const prompts = {}
  for (const [sessionId, set] of sessionTools) if (set.size > 0) tools[sessionId] = [...set]
  for (const [sessionId, set] of sessionPrompts) if (set.size > 0) prompts[sessionId] = [...set]
  return { tools, prompts, promptText: snapshotSessionPromptText(), autoMountControl }
}

/** 启动时从磁盘恢复会话开关。 */
export function hydrateSessionToggles(data) {
  sessionTools.clear()
  sessionPrompts.clear()
  const tools = data && data.tools && typeof data.tools === 'object' ? data.tools : {}
  const prompts = data && data.prompts && typeof data.prompts === 'object' ? data.prompts : {}
  for (const [sessionId, names] of Object.entries(tools)) if (Array.isArray(names) && names.length > 0) sessionTools.set(sessionId, new Set(names))
  for (const [sessionId, names] of Object.entries(prompts)) if (Array.isArray(names) && names.length > 0) sessionPrompts.set(sessionId, new Set(names))
  hydrateSessionPromptText(data && data.promptText)
  if (data && typeof data.autoMountControl === 'boolean') autoMountControl = data.autoMountControl
}

/** sessionId -> Map(section name -> 文本)：会话级提示词覆盖（比全局优先）。 */
const sessionPromptText = new Map()

export function setSessionPromptText(sessionId, name, text) {
  let map = sessionPromptText.get(sessionId)
  if (!map) {
    map = new Map()
    sessionPromptText.set(sessionId, map)
  }
  map.set(name, String(text))
}

export function clearSessionPromptText(sessionId, name) {
  const map = sessionPromptText.get(sessionId)
  if (!map) return
  if (typeof name === "string") map.delete(name)
  else map.clear()
  if (map.size === 0) sessionPromptText.delete(sessionId)
}

export function getSessionPromptTextMap(sessionId) {
  return sessionPromptText.get(sessionId) ?? null
}

export function snapshotSessionPromptText() {
  const out = {}
  for (const [sessionId, map] of sessionPromptText) {
    if (map.size === 0) continue
    out[sessionId] = Object.fromEntries(map)
  }
  return out
}

export function hydrateSessionPromptText(data) {
  sessionPromptText.clear()
  if (!data || typeof data !== "object") return
  for (const [sessionId, entries] of Object.entries(data)) {
    if (!entries || typeof entries !== "object") continue
    const map = new Map()
    for (const [name, text] of Object.entries(entries)) if (typeof text === "string") map.set(name, text)
    if (map.size > 0) sessionPromptText.set(sessionId, map)
  }
}

/** 是否自动把控制行补挂进 agent preset（面板手动停用后置 false，存 session-toggles.json）。 */
let autoMountControl = true

export function setAutoMountControl(value) {
  autoMountControl = value !== false
}

export function getAutoMountControl() {
  return autoMountControl
}

/** 记录控制半侧压缩失败原因，供面板/状态接口展示。 */
export function recordControlError(message) {
  control.lastError = message ? String(message) : null
}
