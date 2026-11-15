/**
 * runtime.js 的直接单测（不需要 Cordis / app.asar）。
 *
 * 这一层的价值：`index.js` 里原本 200+ 个引用点分散在 15 个模块级可变绑定上，
 * handler 无法脱离宿主上下文测试。抽成 runtime 后，状态与路径集中在一处，
 * 这里逐条固定「默认值 / 读写往返 / 拷贝语义 / 队列串行」这些容易被后续改动破坏的契约。
 *
 * 运行：node test/runtime.mjs
 */
import { join } from 'node:path'

import { createRuntime } from '../runtime.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const makeRuntime = (overrides = {}) => createRuntime({
  config: {
    contextWindowTokens: 128000,
    promptOverrides: { persona: 'strict' },
    extraPrompts: { style: 'concise' },
    extraPromptPlacements: { style: 'user' },
    disabledTools: ['bash', 'fetch'],
    ...(overrides.config || {}),
  },
  home: '/home/u',
  dshHome: '/home/u/.dsh',
  stateDir: '/home/u/.dsh/agent-embodiment/profiles/web',
  legacyStateDir: '/home/u/.dsh/agent-embodiment',
  profileName: 'web',
})

const runtime = makeRuntime()

// ── 路径 ──
check('paths.stateDir 原样保留', runtime.paths.stateDir === '/home/u/.dsh/agent-embodiment/profiles/web', runtime.paths.stateDir)
check('paths.backupDir 落在 stateDir 下', runtime.paths.backupDir === join(runtime.paths.stateDir, 'backups'), runtime.paths.backupDir)
check('paths.sessionTogglesPath 正确', runtime.paths.sessionTogglesPath === join(runtime.paths.stateDir, 'session-toggles.json'), runtime.paths.sessionTogglesPath)
check('paths.onboardingPath 正确', runtime.paths.onboardingPath === join(runtime.paths.stateDir, 'onboarding.json'), runtime.paths.onboardingPath)
check('paths.compactionLogPath 正确', runtime.paths.compactionLogPath === join(runtime.paths.stateDir, 'compaction-log.jsonl'), runtime.paths.compactionLogPath)
check('paths 被冻结（防止误改）', Object.isFrozen(runtime.paths), Object.isFrozen(runtime.paths))
check('profileName 透出', runtime.paths.profileName === 'web', runtime.paths.profileName)

// ── config 引用 ──
check('config 按引用暴露（Loader 重挂后是新对象）', runtime.config.contextWindowTokens === 128000, runtime.config.contextWindowTokens)

// ── 服务句柄：默认 null、set(null) 归一化 ──
check('服务默认都是 null', ['getSessions', 'getSessionQuery', 'getConnection', 'getConfigEditor', 'getSessionProjections'].every((name) => runtime[name]() === null))
const fakeSessions = { list: () => [] }
runtime.setSessions(fakeSessions)
check('setSessions 后可读回同一对象', runtime.getSessions() === fakeSessions, runtime.getSessions())
runtime.setSessions(undefined)
check('setSessions(undefined) 归一化为 null', runtime.getSessions() === null, runtime.getSessions())
runtime.setConfigEditor({ edit: () => {} })
check('configEditor 可读回', typeof runtime.getConfigEditor().edit === 'function', runtime.getConfigEditor())

// ── webServerPresent ──
check('webServerPresent 默认 false', runtime.isWebServerPresent() === false)
runtime.markWebServerPresent()
check('markWebServerPresent 置真', runtime.isWebServerPresent() === true)
runtime.setWebServerPresent(false)
check('setWebServerPresent(false) 可复位', runtime.isWebServerPresent() === false)
runtime.setWebServerPresent('yes')
check('setWebServerPresent 只认 true', runtime.isWebServerPresent() === false, runtime.isWebServerPresent())

// ── 状态缓存 / revision ──
check('statusRevision 从 0 开始', runtime.getStatusRevision() === 0)
runtime.bumpStatusRevision()
runtime.bumpStatusRevision()
check('bumpStatusRevision 累加', runtime.getStatusRevision() === 2, runtime.getStatusRevision())
check('状态缓存初始 revision 为 -1', runtime.readStatusCache().revision === -1, runtime.readStatusCache())
runtime.writeStatusCache({ at: 123, revision: 2, text: '{"ok":true}' })
check('写缓存后可读回', runtime.readStatusCache().text === '{"ok":true}' && runtime.readStatusCache().revision === 2, runtime.readStatusCache())

// ── 运行时提示词/工具：初值来自 config，且拷贝而非引用 ──
check('promptOverrides 初值来自 config', runtime.getPromptOverrides().persona === 'strict', runtime.getPromptOverrides())
check('extraPrompts 初值来自 config', runtime.getExtraPrompts().style === 'concise', runtime.getExtraPrompts())
check('placements 初值来自 config', runtime.getExtraPromptPlacements().style === 'user', runtime.getExtraPromptPlacements())
check('disabledTools 初值来自 config', JSON.stringify(runtime.getDisabledTools()) === JSON.stringify(['bash', 'fetch']), runtime.getDisabledTools())

const shared = { a: '1' }
runtime.setExtraPrompts(shared)
shared.a = 'mutated'
check('setExtraPrompts 做浅拷贝（外部改动不回流）', runtime.getExtraPrompts().a === '1', runtime.getExtraPrompts())

const tools = ['bash']
runtime.setDisabledTools(tools)
tools.push('fetch')
check('setDisabledTools 做浅拷贝', runtime.getDisabledTools().length === 1, runtime.getDisabledTools())
runtime.setDisabledTools(null)
check('setDisabledTools(null) 归一化为空数组', Array.isArray(runtime.getDisabledTools()) && runtime.getDisabledTools().length === 0, runtime.getDisabledTools())
runtime.setPromptOverrides(null)
check('setPromptOverrides(null) 归一化为空对象', Object.keys(runtime.getPromptOverrides()).length === 0, runtime.getPromptOverrides())

// ── onboarding 引用 ──
const onboarding = { completed: false, version: '0.38.0' }
runtime.setOnboarding(onboarding)
onboarding.completed = true
check('onboarding 按引用持有（就地更新可见）', runtime.getOnboarding().completed === true, runtime.getOnboarding())
runtime.setOnboarding(undefined)
check('setOnboarding(undefined) 归一化为 null', runtime.getOnboarding() === null, runtime.getOnboarding())

// ── 队列：串行、失败不阻塞后续 ──
const order = []
const first = runtime.enqueuePromptWrite(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20))
  order.push('first')
  return 'first-result'
})
const second = runtime.enqueuePromptWrite(async () => {
  order.push('second')
  return 'second-result'
})
const [firstResult, secondResult] = await Promise.all([first, second])
check('prompt 队列按入队顺序执行', JSON.stringify(order) === JSON.stringify(['first', 'second']), order)
check('队列返回各自结果', firstResult === 'first-result' && secondResult === 'second-result', { firstResult, secondResult })

const failingTask = runtime.enqueuePromptWrite(async () => { throw new Error('boom') })
const after = runtime.enqueuePromptWrite(async () => 'after')
let failedThrew = false
try { await failingTask } catch { failedThrew = true }
check('队列任务失败会抛给调用方', failedThrew)
check('失败不影响后续任务', (await after) === 'after')

const presetOrder = []
await Promise.all([
  runtime.enqueuePresetWrite(async () => { presetOrder.push(1) }),
  runtime.enqueuePresetWrite(async () => { presetOrder.push(2) }),
])
check('preset 队列独立且串行', JSON.stringify(presetOrder) === JSON.stringify([1, 2]), presetOrder)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[runtime] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
