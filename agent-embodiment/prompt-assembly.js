/**
 * `system-prompt/assemble` 里的 section 重建逻辑（0.42.0 从 control.js 抽出）。
 *
 * 输入是「宿主给的 assembly + 各类开关/覆盖」，输出是「重建后的 sections + inventory」。
 * 做成纯函数之后可以逐条断言：禁用 section 被剔除、会话覆盖优先于全局覆盖、
 * frozen section 不被就地修改、extra prompt 的 system/user 两种落点、identity 之后插入、
 * inventory 的 token 估算与 overridden 标记。
 *
 * 注意：这里不做任何 logging 或持久化——调用方负责 `recordInventory` 与异常上报。
 */

const EXTRA_PREFIX = 'agent-embodiment:extra:'
const LEGACY_EXTRA_PREFIX = 'ctx-mon-and-con:extra:'

/** 与既有实现一致的启发式 token 估算（4 字符 ≈ 1 token）。 */
const estimateTokens = (text) => Math.ceil(String(text).length / 4)

/**
 * 把 extra prompt 的名字归一化成 section 名；已是全名时原样返回。
 * @param {string} name
 */
export function extraSectionName(name) {
  return name.startsWith(EXTRA_PREFIX) || name.startsWith(LEGACY_EXTRA_PREFIX) ? name : `${EXTRA_PREFIX}${name}`
}

/**
 * @param {{
 *   sections?: Array<{ name: string, text?: any, interpolate?: any }>,
 *   tools?: any[],
 *   disabledPrompts?: Iterable<string>,
 *   overrides?: Record<string, string>,
 *   sessionTexts?: Map<string, string> | Record<string, string>,
 *   extraPrompts?: Record<string, string>,
 *   extraPlacements?: Record<string, string>,
 * }} input
 * @returns {{ sections: Array<any>, inventory: Array<any>, tools: Array<any> }}
 */
export function buildAssembledSections(input = {}) {
  const raw = Array.isArray(input.sections) ? input.sections : []
  const disabled = new Set(input.disabledPrompts ?? [])
  const overrides = input.overrides ?? {}
  const sessionTexts = input.sessionTexts ?? new Map()
  const readSessionText = (name) => (typeof sessionTexts.get === 'function' ? sessionTexts.get(name) : sessionTexts[name])
  const hasSessionText = (name) => (typeof sessionTexts.has === 'function' ? sessionTexts.has(name) : Object.prototype.hasOwnProperty.call(sessionTexts, name))

  const sections = []
  const inventory = []

  for (const section of raw) {
    if (disabled.has(section.name)) continue
    const original = String(section.text === undefined || section.text === null ? '' : section.text)
    const globalOverridden = Object.prototype.hasOwnProperty.call(overrides, section.name)
    const sessionOverridden = hasSessionText(section.name)
    const effective = sessionOverridden
      ? String(readSessionText(section.name))
      : globalOverridden
        ? String(overrides[section.name])
        : original
    // 原 section 可能是 frozen 的：不改它，重建一个 AssembledSection。
    const next = { name: section.name, text: effective }
    if (section.interpolate !== undefined) next.interpolate = section.interpolate
    sections.push(next)
    inventory.push({
      name: section.name,
      tokens: estimateTokens(effective),
      text: effective,
      originalText: original,
      overridden: globalOverridden || sessionOverridden,
      globalOverridden,
      sessionOverridden,
    })
  }

  const extraPrompts = input.extraPrompts ?? {}
  const extraPlacements = input.extraPlacements ?? {}
  for (const [name, text] of Object.entries(extraPrompts)) {
    const sectionName = extraSectionName(name)
    if (disabled.has(sectionName) || disabled.has(sectionName.replace(EXTRA_PREFIX, LEGACY_EXTRA_PREFIX))) continue
    const value = typeof text === 'string' ? text : ''
    if (value.trim().length === 0) continue
    if (sections.some((section) => section.name === sectionName)) continue
    const placement = extraPlacements[name] === 'user' ? 'user' : 'system'
    const inventoryItem = {
      name: sectionName,
      tokens: estimateTokens(value),
      text: value,
      originalText: value,
      overridden: true,
      globalOverridden: true,
      sessionOverridden: false,
      extra: true,
      extraName: name,
      extraPlacement: placement,
    }
    if (placement === 'user') {
      // 加在每次用户消息末尾，不进入 system sections；inventory 只用于展示/会话开关。
      const atIdentity = inventory.findIndex((section) => section.name === 'harness:identity')
      if (atIdentity >= 0) inventory.splice(atIdentity + 1, 0, inventoryItem)
      else inventory.push(inventoryItem)
      continue
    }
    const item = { name: sectionName, text: value }
    const at = sections.findIndex((section) => section.name === 'harness:identity')
    if (at >= 0) {
      sections.splice(at + 1, 0, item)
      inventory.splice(at + 1, 0, inventoryItem)
    } else {
      sections.push(item)
      inventory.push(inventoryItem)
    }
  }

  const tools = (Array.isArray(input.tools) ? input.tools : []).map((tool) => ({
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : undefined,
    parameters: tool.parameters,
    tokens: estimateTokens(JSON.stringify(tool)),
  }))

  return { sections, inventory, tools }
}
