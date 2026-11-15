/**
 * prompt-assembly.js 的直接单测（不需要 Cordis / app.asar）。
 *
 * 这段是 `system-prompt/assemble` 的核心：谁被禁用、覆盖优先级、extra prompt 落点、
 * inventory 的 token 估算与 overridden 标记。control.mjs 只断言「装配后的结果形状」，
 * 这里则逐条固定边界，尤其是「会话覆盖优先于全局覆盖」与「frozen section 不被就地改」。
 *
 * 运行：node test/prompt-assembly.mjs
 */
import { buildAssembledSections, extraSectionName } from '../prompt-assembly.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const baseSections = () => [
  { name: 'harness:identity', text: 'identity' },
  { name: 'harness:tools', text: 'tools' },
  { name: 'harness:environment', text: 'env' },
]

// ── 基本重建 ──
const plain = buildAssembledSections({ sections: baseSections() })
check('默认原样重建三段', plain.sections.length === 3 && plain.sections[0].name === 'harness:identity', plain.sections.map((s) => s.name))
check('inventory 与 sections 数量一致', plain.inventory.length === plain.sections.length)
check('无覆盖时 overridden 全为 false', plain.inventory.every((item) => item.overridden === false), plain.inventory.map((i) => i.overridden))
check('token 估算按 4 字符≈1', plain.inventory[0].tokens === Math.ceil('identity'.length / 4), plain.inventory[0].tokens)

// ── frozen section 不被就地修改 ──
const frozen = Object.freeze({ name: 'harness:identity', text: Object.freeze('identity') })
const frozenResult = buildAssembledSections({ sections: [frozen, { name: 'harness:tools', text: 'tools' }], overrides: { 'harness:identity': 'changed' } })
check('frozen section 不被就地修改', frozen.text === 'identity' && frozenResult.sections[0].text === 'changed', { original: frozen.text, rebuilt: frozenResult.sections[0].text })

// ── 禁用与覆盖优先级 ──
const disabled = buildAssembledSections({ sections: baseSections(), disabledPrompts: ['harness:tools'] })
check('禁用 section 被剔除', disabled.sections.map((s) => s.name).join(',') === 'harness:identity,harness:environment', disabled.sections.map((s) => s.name))
check('禁用项不出现在 inventory', !disabled.inventory.some((item) => item.name === 'harness:tools'))

const globalOnly = buildAssembledSections({ sections: baseSections(), overrides: { 'harness:identity': 'global-override' } })
check('全局覆盖生效并标记 globalOverridden', globalOnly.sections[0].text === 'global-override' && globalOnly.inventory[0].globalOverridden === true && globalOnly.inventory[0].overridden === true, globalOnly.inventory[0])

const sessionWins = buildAssembledSections({
  sections: baseSections(),
  overrides: { 'harness:identity': 'global-override' },
  sessionTexts: new Map([['harness:identity', 'session-override']]),
})
check('会话覆盖优先于全局覆盖', sessionWins.sections[0].text === 'session-override' && sessionWins.inventory[0].sessionOverridden === true, sessionWins.inventory[0])
check('inventory 保留 originalText', sessionWins.inventory[0].originalText === 'identity', sessionWins.inventory[0].originalText)
check('普通对象形式的 sessionTexts 也支持', buildAssembledSections({ sections: baseSections(), sessionTexts: { 'harness:tools': 'from-object' } }).sections[1].text === 'from-object')

check('text 为 null/undefined 时按空串处理', buildAssembledSections({ sections: [{ name: 'a', text: null }, { name: 'b' }] }).sections.map((s) => s.text).join('|') === '|')
check('interpolate 字段被保留', buildAssembledSections({ sections: [{ name: 'a', text: 'x', interpolate: true }] }).sections[0].interpolate === true)
check('无 interpolate 时不凭空增加字段', !('interpolate' in buildAssembledSections({ sections: [{ name: 'a', text: 'x' }] }).sections[0]))

// ── extra prompts：system 落点 ──
const withSystem = buildAssembledSections({ sections: baseSections(), extraPrompts: { style: 'be terse' } })
check('extra prompt 默认插在 identity 之后', withSystem.sections[1].name === 'agent-embodiment:extra:style', withSystem.sections.map((s) => s.name))
check('extra prompt 的 inventory 带 extra 标记', withSystem.inventory[1].extra === true && withSystem.inventory[1].extraPlacement === 'system' && withSystem.inventory[1].overridden === true, withSystem.inventory[1])

// ── extra prompts：user 落点 ──
const withUser = buildAssembledSections({ sections: baseSections(), extraPrompts: { tone: 'be nice' }, extraPlacements: { tone: 'user' } })
check('user 落点不进入 sections', !withUser.sections.some((s) => s.name.includes('extra')), withUser.sections.map((s) => s.name))
check('user 落点进入 inventory 且在 identity 之后', withUser.inventory[1].extraPlacement === 'user' && withUser.inventory[1].name === 'agent-embodiment:extra:tone', withUser.inventory.map((i) => i.name))

// ── extra prompts：跳过条件 ──
check('空文本的 extra prompt 被跳过', buildAssembledSections({ sections: baseSections(), extraPrompts: { blank: '   ' } }).sections.length === 3)
check('非字符串 text 被跳过', buildAssembledSections({ sections: baseSections(), extraPrompts: { bad: null } }).sections.length === 3)
check('已存在同名 section 时不重复插入', buildAssembledSections({
  sections: [...baseSections(), { name: 'agent-embodiment:extra:style', text: 'already' }],
  extraPrompts: { style: 'be terse' },
}).sections.filter((s) => s.name === 'agent-embodiment:extra:style').length === 1)
check('全名形式的 extra 名保持原样', extraSectionName('agent-embodiment:extra:x') === 'agent-embodiment:extra:x' && extraSectionName('legacy') === 'agent-embodiment:extra:legacy')
check('禁用全名或旧前缀都能拦住 extra prompt', buildAssembledSections({
  sections: baseSections(),
  extraPrompts: { style: 'be terse' },
  disabledPrompts: ['ctx-mon-and-con:extra:style'],
}).sections.length === 3)

// ── 没有 identity 时的落点 ──
const noIdentity = buildAssembledSections({ sections: [{ name: 'harness:tools', text: 't' }], extraPrompts: { style: 'x' } })
check('没有 identity 时追加到末尾', noIdentity.sections[noIdentity.sections.length - 1].name === 'agent-embodiment:extra:style', noIdentity.sections.map((s) => s.name))

// ── tools 估算 ──
const tools = buildAssembledSections({
  sections: [],
  tools: [{ name: 'bash', description: 'run', parameters: { a: 1 } }, { name: 'noDescr' }],
}).tools
check('tools 保留 name/description/parameters', tools[0].name === 'bash' && tools[0].description === 'run' && tools[0].parameters.a === 1, tools[0])
check('缺 description 时为 undefined', tools[1].description === undefined)
check('tools 带 token 估算', tools.every((tool) => Number.isInteger(tool.tokens) && tool.tokens > 0), tools.map((tool) => tool.tokens))
check('sections 非数组时按空处理', buildAssembledSections({ sections: null }).sections.length === 0)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[prompt-assembly] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
