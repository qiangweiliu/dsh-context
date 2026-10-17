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
}

/** 宿主半侧写入全局默认预算。 */
export function setDefaultBudget(tokens) {
  defaultBudget = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : undefined
}

/** 读取全局默认预算（可能为 undefined）。 */
export function getDefaultBudget() {
  return defaultBudget
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

/** 控制半侧激活/卸载时更新状态。 */
export function setControlActive(active, mode) {
  control.active = Boolean(active)
  control.mode = active ? (mode ?? null) : null
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
  return { tools, prompts }
}

/** 启动时从磁盘恢复会话开关。 */
export function hydrateSessionToggles(data) {
  sessionTools.clear()
  sessionPrompts.clear()
  const tools = data && data.tools && typeof data.tools === 'object' ? data.tools : {}
  const prompts = data && data.prompts && typeof data.prompts === 'object' ? data.prompts : {}
  for (const [sessionId, names] of Object.entries(tools)) if (Array.isArray(names) && names.length > 0) sessionTools.set(sessionId, new Set(names))
  for (const [sessionId, names] of Object.entries(prompts)) if (Array.isArray(names) && names.length > 0) sessionPrompts.set(sessionId, new Set(names))
}
