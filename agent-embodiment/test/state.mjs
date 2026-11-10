/**
 * state.js 持久化回归：会话开关/提示词文本/autoMountControl 的导出与恢复。
 *
 * 运行：node test/state.mjs
 * 纯离线，不依赖 Cordis 或 DSH。
 *
 * 这个文件存在的原因：v0.19.0 的 state.js 里 snapshotSessionPromptText /
 * hydrateSessionPromptText 只有调用没有定义，导致 saveSessionToggles 每次都抛
 * ReferenceError 并被吞掉，会话开关实际上从未落盘。
 */
import {
  budgetFor,
  clearAllSessionToggles,
  clearSessionBudget,
  clearSessionToggles,
  getAutoMountControl,
  getControlBudget,
  getSessionDisabledPrompts,
  getSessionDisabledTools,
  getSessionPromptTextMap,
  hydrateSessionToggles,
  setAutoMountControl,
  setControlBudget,
  setDefaultBudget,
  setSessionBudget,
  setSessionPromptEnabled,
  setSessionPromptText,
  setSessionToolEnabled,
  snapshotSessionToggles,
} from '../state.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`)
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 1. 空状态也能安全导出（回归：曾抛 ReferenceError）──────────────────────
let initial
try {
  initial = snapshotSessionToggles()
  check('空状态 snapshotSessionToggles 不抛错', true)
} catch (error) {
  check('空状态 snapshotSessionToggles 不抛错', false, error instanceof Error ? error.message : String(error))
}
check('空状态包含 tools/prompts/promptText/autoMountControl', same(Object.keys(initial ?? {}).sort(), ['autoMountControl', 'promptText', 'prompts', 'tools']), initial)

// ── 2. 三类状态一起写入后能完整导出 ────────────────────────────────────────
setSessionToolEnabled('s1', 'read', false)
setSessionToolEnabled('s1', 'write', false)
setSessionPromptEnabled('s1', 'harness:identity', false)
setSessionPromptText('s1', 'tools:fs', 'SESSION TEXT')
setAutoMountControl(false)

const snapshot = snapshotSessionToggles()
check('snapshot 保存工具开关', same(snapshot.tools.s1?.sort(), ['read', 'write']), snapshot.tools)
check('snapshot 保存提示词开关', same(snapshot.prompts.s1, ['harness:identity']), snapshot.prompts)
check('snapshot 保存会话提示词文本', snapshot.promptText?.s1?.['tools:fs'] === 'SESSION TEXT', snapshot.promptText)
check('snapshot 保存 autoMountControl', snapshot.autoMountControl === false, snapshot.autoMountControl)

// ── 3. 清空后从 snapshot 恢复 ──────────────────────────────────────────────
hydrateSessionToggles({ tools: {}, prompts: {}, promptText: {}, autoMountControl: true })
check('hydrate 清空工具开关', getSessionDisabledTools('s1').length === 0, getSessionDisabledTools('s1'))
check('hydrate 清空提示词文本', getSessionPromptTextMap('s1') === null, getSessionPromptTextMap('s1'))

hydrateSessionToggles(snapshot)
check('恢复工具开关', same(getSessionDisabledTools('s1').sort(), ['read', 'write']), getSessionDisabledTools('s1'))
check('恢复提示词开关', same(getSessionDisabledPrompts('s1'), ['harness:identity']), getSessionDisabledPrompts('s1'))
check('恢复会话提示词文本', getSessionPromptTextMap('s1')?.get('tools:fs') === 'SESSION TEXT', getSessionPromptTextMap('s1')?.get('tools:fs'))
check('恢复 autoMountControl', getAutoMountControl() === false, getAutoMountControl())

clearSessionToggles('s1')
check('clearSessionToggles 同时清工具、提示词开关与文本覆盖', getSessionDisabledTools('s1').length === 0 && getSessionDisabledPrompts('s1').length === 0 && getSessionPromptTextMap('s1') === null, { tools: getSessionDisabledTools('s1'), prompts: getSessionDisabledPrompts('s1'), text: getSessionPromptTextMap('s1') })

setSessionToolEnabled('s2', 'read', false)
setSessionPromptEnabled('s2', 'tools:fs', false)
setSessionPromptText('s2', 'tools:fs', 'S2 TEXT')
clearAllSessionToggles()
check('clearAllSessionToggles 清空所有会话而不动全局 autoMountControl', getSessionDisabledTools('s2').length === 0 && getSessionDisabledPrompts('s2').length === 0 && getSessionPromptTextMap('s2') === null && getAutoMountControl() === false, { tools: getSessionDisabledTools('s2'), prompts: getSessionDisabledPrompts('s2'), text: getSessionPromptTextMap('s2'), auto: getAutoMountControl() })

// ── 4. 非法数据不抛错，且不会留下脏状态 ────────────────────────────────────
let malformed = null
try {
  hydrateSessionToggles({ tools: [], prompts: null, promptText: { s2: { bad: 42, good: 'ok' }, s3: 'nope' }, autoMountControl: 'yes' })
} catch (error) {
  malformed = error instanceof Error ? error.message : String(error)
}
check('非法持久化数据不抛错', malformed === null, malformed)
check('非法文本条目被跳过、合法条目保留', getSessionPromptTextMap('s2')?.get('good') === 'ok' && !getSessionPromptTextMap('s2')?.has('bad'), getSessionPromptTextMap('s2'))
check('非法 autoMountControl 被忽略', getAutoMountControl() === false, getAutoMountControl())

// ── 5. 会话键控状态有上限，导出不会无限增长 ────────────────────────────────
const many = { tools: {}, prompts: {}, promptText: {}, autoMountControl: true }
for (let index = 0; index < 260; index += 1) many.tools[`s-${index}`] = ['read']
hydrateSessionToggles(many)
const capped = snapshotSessionToggles()
check('会话状态按 200 个会话截断', Object.keys(capped.tools).length === 200, Object.keys(capped.tools).length)

// ── 6. 预算优先级：会话覆盖 > 控制行显式预算 > 宿主全局 > 兜底 ────────────
// 回归：0.24.1 之前控制行 maxContextTokens 只是 budgetFor 的 fallback，
// 而宿主 contextWindowTokens 恒有默认值，导致行配置永远不生效。
setDefaultBudget(128000)
setControlBudget(0)
check('控制行为 0 时跟随宿主全局', budgetFor('budget-a') === 128000, budgetFor('budget-a'))
setControlBudget(200000)
check('控制行显式预算优先于宿主全局', budgetFor('budget-a') === 200000, budgetFor('budget-a'))
check('getControlBudget 读到显式值', getControlBudget() === 200000, getControlBudget())
setSessionBudget('budget-a', 64000)
check('会话覆盖优先于控制行', budgetFor('budget-a') === 64000, budgetFor('budget-a'))
check('其它会话仍用控制行预算', budgetFor('budget-b') === 200000, budgetFor('budget-b'))
clearSessionBudget('budget-a')
setControlBudget(0)
check('清掉控制行后回到宿主全局', budgetFor('budget-a') === 128000, budgetFor('budget-a'))
setControlBudget(-1)
check('负数预算被视为未设置', getControlBudget() === 0, getControlBudget())
setDefaultBudget(undefined)
check('两半都没配置时回落 100000', budgetFor('budget-c') === 100000, budgetFor('budget-c'))

// 复位全局状态，避免影响同进程内的其他测试。
hydrateSessionToggles({ tools: {}, prompts: {}, promptText: {}, autoMountControl: true })

const failed = checks.filter((item) => !item.ok)
console.log(`\n[state] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[state] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
