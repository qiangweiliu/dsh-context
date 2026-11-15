/**
 * 本仓库骨架的离线冒烟测试（不启动 DSH、不碰用户 profile）。
 *
 * 用真实的 Cordis 4.0.5（从 DSH 的 app.asar 解出，见 test/prepare-deps.ps1）
 * 加载 index.js，并用两个 mock 服务顶替宿主真实服务：
 *   - commands  : 只要 register() 返回 disposer（真实实现见 @deepseek-ai/dsh-commands）
 *   - tokenMeter: measure(session) 返回测量快照（真实实现见 @deepseek-ai/dsh-token-meter）
 *
 * 验证点：
 *   1. 插件是合法 Cordis 插件（name/inject/Config/apply 被识别）
 *   2. Config 走 Standard Schema 同步校验，非法配置被拒绝
 *   3. /embody 注册成功（/ctx 为兼容别名）、输出格式正确、参数覆盖上下文生效、非法参数返回 error
 *   4. 浏览器状态路由 /api/agent-embodiment/status 注册、返回 JSON、非 GET 405
 *   5. 卸载插件后命令注销（disposer 生效）
 *   6. 包资源（client/icon/locale）能被 exports 解析，dsh.client 声明合法
 *   7. client.js 在 mock 的 __ModuleLoader__/cordis 上下文里能 apply 并注册 settings.section
 *
 * 运行：node test/smoke.mjs
 * 前提：test/deps/dsh/node_modules/@deepseek-ai/{cordis,cosmokit} 存在。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadClient } from './client-harness.mjs'

// 测试用临时 HOME：plugin 的落盘只写临时目录，不碰真实用户 profile。
const testHome = mkdtempSync(join(tmpdir(), 'ctx-smoke-home-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome
// 0.32.0 起插件尊重 DSH_HOME；测试必须清掉，否则状态会落到真实 dsh home。
delete process.env.DSH_HOME

const depsRoot = new URL('./deps/dsh/node_modules/@deepseek-ai/', import.meta.url)
const cordisEntry = new URL('cordis/lib/index.js', depsRoot)
if (!existsSync(fileURLToPath(cordisEntry))) {
  console.error(`[smoke] 缺少 ${fileURLToPath(cordisEntry)}；先运行 node test/prepare-deps.mjs（从 app.asar 离线解出，交付不带第三方副本）`)
  process.exit(2)
}

const { Context, Service } = await import(cordisEntry.href)
const plugin = await import(new URL('../index.js', import.meta.url).href)

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}

// ── mock 服务 ─────────────────────────────────────────────────────────────
class MockCommands extends Service {
  constructor(ctx) {
    super(ctx, 'commands')
    this.definitions = new Map()
  }
  register(definition) {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate command ${definition.name}`)
    this.definitions.set(definition.name, definition)
    return () => this.definitions.delete(definition.name)
  }
}

const FAKE_MEASUREMENT = Object.freeze({
  logRevision: 12,
  baseline: Object.freeze({ kind: 'estimated', tokens: 42350 }),
  surfaceDeltaTokens: 0,
  totalTokens: 42350,
  surfaceTokens: 41200,
  nodes: Object.freeze([{ tokens: 40000 }, { tokens: 1200 }]),
})

class MockTokenMeter extends Service {
  constructor(ctx) {
    super(ctx, 'tokenMeter')
    this.calls = 0
  }
  measure(session) {
    this.calls += 1
    if (!session || typeof session !== 'object') throw new Error('measure() expects a session object')
    return FAKE_MEASUREMENT
  }
}

class MockWebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    this.routes = new Map()
  }
  register(route) {
    if (this.routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
    this.routes.set(route.path, route)
    return () => this.routes.delete(route.path)
  }
}

/** 模拟 DSH connection 的 admission：x-test-auth: deny 时拒绝。 */
class MockConnection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
  }
  requestRejection(request) {
    return request?.headers?.['x-test-auth'] === 'deny' ? 401 : undefined
  }
}


// ── 1. 合法插件形状 ───────────────────────────────────────────────────────
check('exports name', plugin.name === 'agent-embodiment', plugin.name)
check('exports inject', Array.isArray(plugin.inject) && plugin.inject.join(',') === 'commands,tokenMeter', JSON.stringify(plugin.inject))
check('exports Config standard schema', typeof plugin.Config?.['~standard']?.validate === 'function')
check('exports apply function', typeof plugin.apply === 'function')

const root = new Context()
await root.plugin(MockCommands)
await root.plugin(MockTokenMeter)
await root.plugin(MockWebServer)
await root.plugin(MockConnection)
const commands = root.get('commands')
const webServer = root.get('webServer')

const fiber = root.plugin(plugin, { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9 })
await fiber

// ── 2. 命令注册 ───────────────────────────────────────────────────────────
const definition = commands.definitions.get('embody')
check('/embody registered', Boolean(definition), [...commands.definitions.keys()].join(','))
check('/embody has input hint', definition?.input?.hint === '[tokens|reset]', definition?.input?.hint)
check('/ctx legacy alias registered', commands.definitions.has('ctx'), [...commands.definitions.keys()].join(','))

const agent = { session: { id: 'smoke-session' } }
const invoke = async (rawInput = '') => {
  const outcome = await definition.handler({ commandId: 'cmd-smoke', agent, rawInput, signal: new AbortController().signal })
  return outcome
}

// ── 3. 输出与参数 ─────────────────────────────────────────────────────────
const normal = await invoke()
check('/embody 正常输出 success', normal.kind === 'success', normal.text)
check('/embody 显示总用量', normal.text?.includes('42,350'), normal.text)
check('/embody 显示上下文', normal.text?.includes('128,000'), normal.text)
check('/embody 显示百分比与状态', normal.text?.includes('33.1%') && normal.text?.includes('ok'), normal.text)

const warned = await invoke('48000')
check('/embody 参数覆盖上下文', warned.kind === 'success' && warned.text?.includes('48,000'), warned.text)
check('/embody 到达 warnAt 标记警告', warned.text?.includes('88.2%') && warned.text?.includes('警告'), warned.text)

const over = await invoke('40000')
check('/embody 超过 errorAt 标记超限', over.text?.includes('105.9%') && over.text?.includes('超限'), over.text)

const bad = await invoke('abc')
check('/embody 非法参数返回 error', bad.kind === 'error' && bad.text?.includes('/embody'), bad.text)

const reset = await invoke('reset')
check('/embody reset 清除会话覆盖', reset.kind === 'success' && reset.text?.includes('128,000'), reset.text)
const resetAgain = await invoke('reset')
check('/embody reset 无覆盖时说明使用默认', resetAgain.kind === 'success' && resetAgain.text?.includes('没有临时上下文'), resetAgain.text)

const cancelled = await definition.handler({ commandId: 'c', agent, rawInput: '', signal: AbortSignal.abort() })
check('/embody 已取消信号返回 error', cancelled.kind === 'error', cancelled.text)

// ── 3b. 浏览器状态路由（client.js 的数据源）────────────────────────────────
await new Promise((resolve) => setTimeout(resolve, 0))
const statusRoute = webServer.routes.get('/api/agent-embodiment/status')
check('注册状态路由 /api/agent-embodiment/status', statusRoute?.kind === 'exact', statusRoute?.path)
const makeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value
  },
  end(body) {
    this.body = body ?? ''
  },
})
const statusResponse = makeResponse()
statusRoute?.handler({ method: 'GET' }, statusResponse)
const statusPayload = statusResponse.body ? JSON.parse(statusResponse.body) : {}
check('状态路由 200 + JSON', statusResponse.statusCode === 200 && String(statusResponse.headers['content-type']).includes('application/json'), statusResponse.statusCode)
check('状态含上下文', statusPayload.budget?.tokens === 128000, JSON.stringify(statusPayload.budget))
check('状态含触发/目标阈值', statusPayload.budget?.triggerAt === 0.9 && statusPayload.budget?.targetAt === 0.6, JSON.stringify(statusPayload.budget))
check('状态含宿主 keepTokens', statusPayload.budget?.keepTokens === 0, JSON.stringify(statusPayload.budget))
check('状态含最近测量', statusPayload.measurements?.[0]?.id === 'smoke-session', JSON.stringify(statusPayload.measurements))
check('状态含会话上下文列表（reset 后为空）', Array.isArray(statusPayload.sessionBudgets) && statusPayload.sessionBudgets.length === 0, JSON.stringify(statusPayload.sessionBudgets))
check('状态含控制状态（未挂控制行 = 未激活）', statusPayload.control?.active === false, JSON.stringify(statusPayload.control))
check('状态含官方人民币价目与当前峰谷', statusPayload.pricing?.currency === 'CNY' && statusPayload.pricing?.models?.length === 2 && typeof statusPayload.pricing?.peakNow === 'boolean', JSON.stringify(statusPayload.pricing))
check('状态含压缩记录数组', Array.isArray(statusPayload.control?.log), JSON.stringify(statusPayload.control?.log))

// 压缩记录落盘：state 事件 -> 宿主订阅 -> JSONL 文件（写入临时 HOME）
const stateModule = await import(new URL('../state.js', import.meta.url).href)
stateModule.recordCompactionEvent({ outcome: 'success', trigger: 'manual', sessionId: 'smoke-session', before: 150000, after: 50000, budget: 128000, rounds: 1 })
const compactionLogPath = join(testHome, '.dsh', 'agent-embodiment', 'compaction-log.jsonl')
const compactionLogLines = existsSync(compactionLogPath) ? readFileSync(compactionLogPath, 'utf8').trim().split('\n').filter(Boolean) : []
check('压缩事件落盘 JSONL（宿主订阅）', compactionLogLines.length === 1 && JSON.parse(compactionLogLines[0]).outcome === 'success' && JSON.parse(compactionLogLines[0]).after === 50000, JSON.stringify(compactionLogLines))
const logResponse = makeResponse()
statusRoute?.handler({ method: 'GET' }, logResponse)
const logPayload = logResponse.body ? JSON.parse(logResponse.body) : {}
check('status 返回刚写入的压缩记录', Array.isArray(logPayload.control?.log) && logPayload.control.log.some((entry) => entry.outcome === 'success' && entry.after === 50000), JSON.stringify(logPayload.control?.log))
const methodResponse = makeResponse()
statusRoute?.handler({ method: 'POST' }, methodResponse)
check('状态路由非 GET 返回 405', methodResponse.statusCode === 405, methodResponse.statusCode)

// DSH connection admission 被拒绝时必须 401，不能绕过到 handler。
const deniedResponse = makeResponse()
statusRoute?.handler({ method: 'GET', headers: { 'x-test-auth': 'deny' } }, deniedResponse)
check('状态路由遵循 connection admission（401）', deniedResponse.statusCode === 401, deniedResponse.statusCode)

// ── 3c. Agent Embodiment Scaffold 路由 ────────────────────────────────────
const scaffoldTemplates = webServer.routes.get('/api/agent-embodiment/status/scaffold/templates')
const scaffoldPreview = webServer.routes.get('/api/agent-embodiment/status/scaffold/preview')
const scaffoldGenerate = webServer.routes.get('/api/agent-embodiment/status/scaffold/generate')
check('注册 scaffold/templates 路由', scaffoldTemplates?.kind === 'exact', scaffoldTemplates?.path)
check('注册 scaffold/preview 路由', scaffoldPreview?.kind === 'exact', scaffoldPreview?.path)
check('注册 scaffold/generate 路由', scaffoldGenerate?.kind === 'exact', scaffoldGenerate?.path)

const makeJsonRequest = (method, payload, headers = { 'content-type': 'application/json' }) => {
  const request = new EventEmitter()
  request.method = method
  request.url = '/'
  request.headers = headers
  request.destroy = () => {}
  setImmediate(() => {
    request.emit('data', Buffer.from(JSON.stringify(payload)))
    request.emit('end')
  })
  return request
}
const callJson = (route, method, payload) => new Promise((resolve) => {
  const response = makeResponse()
  const originalEnd = response.end.bind(response)
  response.end = (body) => {
    originalEnd(body)
    resolve(response)
  }
  route.handler(makeJsonRequest(method, payload), response)
})

// 跨站 text/plain 简单请求不能触发写操作。
const plainResponse = makeResponse()
const plainDone = new Promise((resolve) => {
  const originalEnd = plainResponse.end.bind(plainResponse)
  plainResponse.end = (body) => {
    originalEnd(body)
    resolve()
  }
})
scaffoldPreview?.handler(makeJsonRequest('POST', {}, { 'content-type': 'text/plain' }), plainResponse)
await plainDone
check('POST 非 application/json 返回 415', plainResponse.statusCode === 415, plainResponse.statusCode)

// 面板里的「本会话预算」入口：POST /status/session-budget 与 /embody <tokens> 等价。
const sessionBudgetRoute = webServer.routes.get('/api/agent-embodiment/status/session-budget')
if (sessionBudgetRoute) {
  const setBudget = await callJson(sessionBudgetRoute, 'POST', { sessionId: 'smoke-budget', tokens: 4242 })
  const setPayload = JSON.parse(setBudget.body || '{}')
  check('session-budget：设置返回 202 并回显预算', setBudget.statusCode === 202 && setPayload.tokens === 4242, { status: setBudget.statusCode, tokens: setPayload.tokens })
  const listAfterSet = setPayload.sessionBudgets || []
  check('session-budget：设置后出现在 sessionBudgets 里', listAfterSet.some((row) => row && row.tokens === 4242), listAfterSet)
  const clearBudget = await callJson(sessionBudgetRoute, 'POST', { sessionId: 'smoke-budget', tokens: null })
  const clearPayload = JSON.parse(clearBudget.body || '{}')
  check('session-budget：tokens=null 清除覆盖', clearBudget.statusCode === 202 && clearPayload.tokens === null, { status: clearBudget.statusCode, tokens: clearPayload.tokens })
  const badBudget = await callJson(sessionBudgetRoute, 'POST', { sessionId: 'smoke-budget', tokens: -5 })
  check('session-budget：非法 tokens 返回 400', badBudget.statusCode === 400, badBudget.statusCode)
  const noSession = await callJson(sessionBudgetRoute, 'POST', { tokens: 1000 })
  check('session-budget：缺 sessionId 返回 400', noSession.statusCode === 400, noSession.statusCode)
} else {
  check('session-budget 路由已注册', false, 'route missing')
}

const listResponse = makeResponse()
scaffoldTemplates?.handler({ method: 'GET' }, listResponse)
const listPayload = listResponse.body ? JSON.parse(listResponse.body) : {}
check('scaffold/templates 返回 6 个模板', listResponse.statusCode === 200 && listPayload.templates?.length === 6, JSON.stringify(listPayload.templates?.map((item) => item.id)))

const previewResponse = await callJson(scaffoldPreview, 'POST', { template: 'repo-coder', slug: 'smoke-coder' })
const previewPayload = previewResponse.body ? JSON.parse(previewResponse.body) : {}
check('scaffold/preview 返回文件与 preset', previewResponse.statusCode === 200 && previewPayload.presetId === 'smoke-coder' && previewPayload.files?.length >= 10, JSON.stringify({ status: previewResponse.statusCode, preset: previewPayload.presetId, files: previewPayload.files?.length }))
check('scaffold/preview 默认不含 process skill', !previewPayload.files?.some((file) => /sense-environment|verify-change/u.test(file.path)), previewPayload.files?.map((file) => file.path))
const processPreviewResponse = await callJson(scaffoldPreview, 'POST', { template: 'repo-coder', slug: 'smoke-coder', processSkills: true })
const processPreviewPayload = processPreviewResponse.body ? JSON.parse(processPreviewResponse.body) : {}
check('scaffold/preview processSkills 含 sense/verify', processPreviewPayload.files?.some((file) => file.path.endsWith('/sense-environment/SKILL.md')) && processPreviewPayload.files?.some((file) => file.path.endsWith('/verify-change/SKILL.md')), processPreviewPayload.files?.map((file) => file.path))
const previewPatch = previewPayload.files?.find((file) => file.path.endsWith('dsh.bundle.patch.yml'))?.content ?? ''
check('scaffold/preview patch 含 preset 行', previewPatch.includes('id: "preset-smoke-coder"') && previewPatch.includes('@deepseek-ai/dsh-agent-preset'), previewPatch.slice(0, 120))

const scaffoldRoot = mkdtempSync(join(tmpdir(), 'ctx-scaffold-'))
const generateResponse = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: 'smoke-coder', targetDir: scaffoldRoot })
const generatePayload = generateResponse.body ? JSON.parse(generateResponse.body) : {}
check('scaffold/generate 写入文件', generateResponse.statusCode === 202 && existsSync(join(scaffoldRoot, '.dsh/scaffolds/smoke-coder/dsh.bundle.patch.yml')), JSON.stringify({ status: generateResponse.statusCode, error: generatePayload.error }))
check('scaffold/generate 写入工作区 skill', existsSync(join(scaffoldRoot, '.agents/skills/smoke-coder-repo-coder/SKILL.md')))
const duplicateResponse = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: 'smoke-coder', targetDir: scaffoldRoot })
check('scaffold/generate 默认拒绝覆盖', duplicateResponse.statusCode === 409, duplicateResponse.statusCode)
const overwriteResponse = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: 'smoke-coder', targetDir: scaffoldRoot, overwrite: true })
check('scaffold/generate overwrite:true 可覆盖', overwriteResponse.statusCode === 202, overwriteResponse.statusCode)
const traversalResponse = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: '../escape', targetDir: scaffoldRoot })
check('scaffold/generate 拒绝非法 slug', traversalResponse.statusCode === 400, traversalResponse.statusCode)
rmSync(scaffoldRoot, { recursive: true, force: true })

const agentsRoot = mkdtempSync(join(tmpdir(), 'ctx-scaffold-agents-'))
writeFileSync(join(agentsRoot, 'AGENTS.md'), '# User rules\n\n- keep me\n', 'utf8')
const agentsResponse = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: 'agents-smoke', targetDir: agentsRoot, writeAgents: true })
const agentsContent = readFileSync(join(agentsRoot, 'AGENTS.md'), 'utf8')
check('scaffold/generate 合并 AGENTS.md', agentsResponse.statusCode === 202 && agentsContent.includes('- keep me') && agentsContent.includes('<!-- agent-scaffold:agents-smoke:start -->'), agentsContent.slice(0, 300))
const agentsAgain = await callJson(scaffoldGenerate, 'POST', { template: 'repo-coder', slug: 'agents-smoke', targetDir: agentsRoot, overwrite: true, writeAgents: true })
const agentsContentAgain = readFileSync(join(agentsRoot, 'AGENTS.md'), 'utf8')
check('scaffold/generate AGENTS.md 合并幂等', agentsAgain.statusCode === 202 && (agentsContentAgain.match(/<!-- agent-scaffold:agents-smoke:start -->/g) ?? []).length === 1 && agentsContentAgain.includes('- keep me'), agentsContentAgain.slice(0, 300))
rmSync(agentsRoot, { recursive: true, force: true })

// ── 4. 配置校验 ───────────────────────────────────────────────────────────
let validationError
try {
  await root.plugin(plugin, { contextWindowTokens: -1 })
} catch (error) {
  validationError = error
}
check('非法 Config 被 ValidationError 拒绝', validationError?.name === 'ValidationError' && /contextWindowTokens/.test(validationError.message), validationError?.message)

let unknownKeyError
try {
  await root.plugin(plugin, { window: 1000 })
} catch (error) {
  unknownKeyError = error
}
check('未知配置键被拒绝', unknownKeyError?.name === 'ValidationError' && /unknown config key/.test(unknownKeyError.message), unknownKeyError?.message)

const aggressive = plugin.Config['~standard'].validate({ compressionStrategy: 'aggressive', contextWindowTokens: 100000 })
check('compressionStrategy=aggressive 套用 0.75/0.5/10%', aggressive.value?.triggerAt === 0.75 && aggressive.value?.targetAt === 0.5 && aggressive.value?.keepTokens === 10000, JSON.stringify(aggressive.value))
const overridden = plugin.Config['~standard'].validate({ compressionStrategy: 'aggressive', contextWindowTokens: 100000, triggerAt: 1, targetAt: 0.8 })
check('显式 trigger/target 覆盖 preset', overridden.value?.triggerAt === 1 && overridden.value?.targetAt === 0.8, JSON.stringify(overridden.value))
const badStrategy = plugin.Config['~standard'].validate({ compressionStrategy: 'nope' })
check('非法 compressionStrategy 被拒绝', Array.isArray(badStrategy.issues) && /conservative, balanced, aggressive/.test(badStrategy.issues[0]?.message ?? ''), JSON.stringify(badStrategy.issues))
const analytics = plugin.Config['~standard'].validate({ analyticsLimit: 200 })
check('analyticsLimit 上限 200 可用', analytics.value?.analyticsLimit === 200, JSON.stringify(analytics.value?.analyticsLimit))
const badAnalytics = plugin.Config['~standard'].validate({ analyticsLimit: 201 })
check('analyticsLimit 超过 200 被拒绝', Array.isArray(badAnalytics.issues) && /1\.\.200/.test(badAnalytics.issues[0]?.message ?? ''), JSON.stringify(badAnalytics.issues))

// ── 5. 卸载清理 ───────────────────────────────────────────────────────────
// ── 3h. 其余写路由与导出（此前零覆盖）─────────────────────────────────────
const routeOf = (suffix) => webServer.routes.get(`/api/agent-embodiment/status${suffix}`)
const onboardingRoute = routeOf('/onboarding')
const exportRoute = routeOf('/export')
const configRoute = routeOf('/config')
const presetRoute = routeOf('/config/preset')
const dataResetRoute = routeOf('/data/reset')
const toggleRoute = routeOf('/inventory/toggle')
const promptResetRoute = routeOf('/inventory/prompt/reset')
const extraPromptRoute = routeOf('/inventory/extra-prompt')
const extraPromptResetRoute = routeOf('/inventory/extra-prompt/reset')
check(
  '注册 onboarding/export/config/data-reset/inventory 写路由',
  [onboardingRoute, exportRoute, configRoute, presetRoute, dataResetRoute, toggleRoute, promptResetRoute, extraPromptRoute, extraPromptResetRoute].every((route) => route?.kind === 'exact'),
  [onboardingRoute, exportRoute, configRoute, presetRoute, dataResetRoute, toggleRoute, promptResetRoute, extraPromptRoute, extraPromptResetRoute].map((route) => route?.path ?? null),
)

const callGet = (route, url = '/') => new Promise((resolve) => {
  const response = makeResponse()
  const originalEnd = response.end.bind(response)
  response.end = (body) => {
    originalEnd(body)
    resolve(response)
  }
  route.handler({ method: 'GET', url, headers: {} }, response)
})

// onboarding 是纯写接口：读状态走 /status，别让面板误以为可以 GET。
const onboardingGet = await callGet(onboardingRoute)
check('GET /onboarding 返回 405（只读写 /status）', onboardingGet.statusCode === 405, onboardingGet.body)

// 没有 sessionQuery 时必须失败关闭，而不是静默导出空表。
const exportNoQuery = await callGet(exportRoute, '/?limit=5')
check('GET /export 缺少 sessionQuery 时返回 503', exportNoQuery.statusCode === 503, exportNoQuery.body)

const badScope = await callJson(dataResetRoute, 'POST', { scope: 'bogus' })
check('POST /data/reset 非法 scope 返回 400', badScope.statusCode === 400, badScope.body)
const togglesReset = await callJson(dataResetRoute, 'POST', { scope: 'toggles' })
check('POST /data/reset {scope:toggles} 返回 202', togglesReset.statusCode === 202, togglesReset.body)

const badToggle = await callJson(toggleRoute, 'POST', { kind: 'bogus', layer: 'session', name: 'x', enabled: true })
check('POST /inventory/toggle 非法参数返回 400', badToggle.statusCode === 400, badToggle.body)
const globalPrompt = await callJson(toggleRoute, 'POST', { kind: 'prompt', layer: 'global', name: 'x', enabled: true })
check('POST /inventory/toggle 全局提示词开关被拒绝（400）', globalPrompt.statusCode === 400, globalPrompt.body)

const emptyExtra = await callJson(extraPromptRoute, 'POST', { name: 'x', text: '   ' })
check('POST /inventory/extra-prompt 空文本返回 400', emptyExtra.statusCode === 400, emptyExtra.body)
const noEditorExtra = await callJson(extraPromptRoute, 'POST', { name: 'x', text: 'hi' })
check('POST /inventory/extra-prompt 无 configEditor 返回 501', noEditorExtra.statusCode === 501, noEditorExtra.body)
const noEditorPromptReset = await callJson(promptResetRoute, 'POST', {})
check('POST /inventory/prompt/reset 无 configEditor 返回 501', noEditorPromptReset.statusCode === 501, noEditorPromptReset.body)
const configNoEditor = await callJson(configRoute, 'POST', { contextWindowTokens: 200000 })
check('POST /config 无 configEditor 返回 501', configNoEditor.statusCode === 501, configNoEditor.body)
const presetNoEditor = await callJson(presetRoute, 'POST', { enable: false })
check('POST /config/preset 无 configEditor 返回 501', presetNoEditor.statusCode === 501, presetNoEditor.body)

// ── 隔离上下文：带上 configEditor + sessionQuery，验证成功路径真的落盘 ──
class MockConfigEditor extends Service {
  constructor(ctx) {
    super(ctx, 'configEditor')
    this.patches = []
  }
  entries() {
    return [{ options: { id: 'agent-embodiment' }, value: {} }]
  }
  async edit(entry, updater) {
    const next = updater({})
    this.patches.push(next)
    return next
  }
}

class MockSessionQuery extends Service {
  constructor(ctx) {
    super(ctx, 'sessionQuery')
  }
  async listSessions() {
    return []
  }
  async observeSession() {
    return null
  }
}

const editorRoot = new Context()
await editorRoot.plugin(MockCommands)
await editorRoot.plugin(MockTokenMeter)
await editorRoot.plugin(MockWebServer)
await editorRoot.plugin(MockConnection)
await editorRoot.plugin(MockConfigEditor)
await editorRoot.plugin(MockSessionQuery)
const editorFiber = editorRoot.plugin(plugin, {})
await editorFiber
const editorRoutes = (suffix) => editorRoot.get('webServer').routes.get(`/api/agent-embodiment/status${suffix}`)

const pricedResponse = await callJson(editorRoutes('/config'), 'POST', {
  modelPricing: [
    { match: 'custom-model', input: 1, cacheRead: 0.5, cacheWrite: 1, output: 2, peak: { input: 1.5, output: 3 }, offPeak: { input: 0.5, output: 1 } },
  ],
})
const pricedPayload = JSON.parse(pricedResponse.body || '{}')
check('POST /config 返回 202 并回显接受的补丁', pricedResponse.statusCode === 202 && pricedPayload.ok === true, pricedResponse.body)
await new Promise((resolve) => setTimeout(resolve, 10))
const recorded = editorRoot.get('configEditor').patches.at(-1) ?? {}
check(
  'POST /config 落盘时保留峰谷两档（回归：曾被拍平成全天同价）',
  Array.isArray(recorded.modelPricing) && recorded.modelPricing[0]?.peak?.input === 1.5 && recorded.modelPricing[0]?.offPeak?.output === 1,
  recorded.modelPricing,
)

const badHolidays = await callJson(editorRoutes('/config'), 'POST', { holidays: ['2027/01/01'] })
check('POST /config 非法 holidays 返回 400', badHolidays.statusCode === 400, badHolidays.body)
const goodHolidays = await callJson(editorRoutes('/config'), 'POST', { holidays: ['2027-01-01'] })
check('POST /config 合法 holidays 返回 202', goodHolidays.statusCode === 202, goodHolidays.body)
await new Promise((resolve) => setTimeout(resolve, 10))
const holidayPatch = editorRoot.get('configEditor').patches.at(-1) ?? {}
check('POST /config holidays 写入数组', Array.isArray(holidayPatch.holidays) && holidayPatch.holidays[0] === '2027-01-01', holidayPatch.holidays)

const extraSaved = await callJson(editorRoutes('/inventory/extra-prompt'), 'POST', { name: 'smoke-extra', text: 'hello', placement: 'user' })
check('POST /inventory/extra-prompt 有 configEditor 时返回 202', extraSaved.statusCode === 202, extraSaved.body)
const extraCleared = await callJson(editorRoutes('/inventory/extra-prompt/reset'), 'POST', { name: 'smoke-extra' })
check('POST /inventory/extra-prompt/reset 返回 202', extraCleared.statusCode === 202, extraCleared.body)
const promptCleared = await callJson(editorRoutes('/inventory/prompt/reset'), 'POST', {})
check('POST /inventory/prompt/reset 有 configEditor 时返回 2xx', [200, 202].includes(promptCleared.statusCode), promptCleared.body)

const exportJson = await callGet(editorRoutes('/export'), '/?limit=5')
const exportBody = JSON.parse(exportJson.body || '{}')
check('GET /export 返回 JSON 与 sessions 数组', exportJson.statusCode === 200 && String(exportJson.headers['content-type']).includes('application/json') && Array.isArray(exportBody.sessions), Object.keys(exportBody))
const exportCsv = await callGet(editorRoutes('/export'), '/?format=csv&limit=5')
// CSV 带 UTF-8 BOM（Excel 打开不乱码），断言时先剥掉再比对列名。
const exportCsvBody = String(exportCsv.body).replace(/^\uFEFF/u, '')
check(
  'GET /export?format=csv 返回 text/csv、带 BOM 且首行是列名',
  exportCsv.statusCode === 200 && String(exportCsv.headers['content-type']).startsWith('text/csv') && String(exportCsv.body).startsWith('\uFEFF') && exportCsvBody.split('\n')[0].startsWith('id,title'),
  exportCsvBody.slice(0, 60),
)

const resetOnboarding = await callJson(editorRoutes('/onboarding'), 'POST', { reset: true })
check('POST /onboarding {reset} 返回 202', resetOnboarding.statusCode === 202, resetOnboarding.body)
const editorStatus = await callGet(editorRoutes(''))
const editorStatusBody = JSON.parse(editorStatus.body || '{}')
check('重置后 /status 的 onboarding.completed=false', editorStatusBody.onboarding?.completed === false, JSON.stringify(editorStatusBody.onboarding))

const presetDisable = await callJson(editorRoutes('/config/preset'), 'POST', { enable: false })
check('POST /config/preset 无 preset 条目时返回 501', presetDisable.statusCode === 501, presetDisable.body)
try { await editorFiber.dispose() } catch {}

// ── 3i. 会话级提示词与会话重置（此前无覆盖）───────────────────────────────
const sessionPromptRoute = webServer.routes.get('/api/agent-embodiment/status/inventory/prompt/session')
const sessionPromptResetRoute = webServer.routes.get('/api/agent-embodiment/status/inventory/prompt/session/reset')
const inventoryResetRoute = webServer.routes.get('/api/agent-embodiment/status/inventory/reset')
check(
  '注册 inventory/reset 与会话级提示词路由',
  [sessionPromptRoute, sessionPromptResetRoute, inventoryResetRoute].every((route) => route?.kind === 'exact'),
  [sessionPromptRoute, sessionPromptResetRoute, inventoryResetRoute].map((route) => route?.path ?? null),
)

const stateApi = await import('../state.js')
const TEST_SESSION = 'smoke-session-1'

const badText = await callJson(sessionPromptRoute, 'POST', { name: 'persona', sessionId: TEST_SESSION })
check('会话提示词缺 text 返回 400', badText.statusCode === 400, badText.body)
const noSessionText = await callJson(sessionPromptRoute, 'POST', { name: 'persona', text: 'x' })
check('会话提示词无 sessionId 且无会话时返回 409', noSessionText.statusCode === 409, noSessionText.body)

const savedText = await callJson(sessionPromptRoute, 'POST', { name: 'persona', text: '你是资深审阅者', sessionId: TEST_SESSION })
const savedPayload = JSON.parse(savedText.body || '{}')
check('会话提示词保存返回 202 并回显 sessionId', savedText.statusCode === 202 && savedPayload.sessionId === TEST_SESSION, savedText.body)
const textMap = () => stateApi.getSessionPromptTextMap(TEST_SESSION)
check('会话提示词真的写入状态', textMap()?.get('persona') === '你是资深审阅者', textMap() ? [...textMap()] : null)

const resetOne = await callJson(sessionPromptResetRoute, 'POST', { name: 'persona', sessionId: TEST_SESSION })
check('按 name 清除会话提示词返回 202', resetOne.statusCode === 202, resetOne.body)
check('清除后该 section 文本消失', textMap()?.get('persona') === undefined, textMap() ? [...textMap()] : null)

await callJson(sessionPromptRoute, 'POST', { name: 'persona', text: 'a', sessionId: TEST_SESSION })
await callJson(sessionPromptRoute, 'POST', { name: 'tone', text: 'b', sessionId: TEST_SESSION })
const resetAll = await callJson(sessionPromptResetRoute, 'POST', { sessionId: TEST_SESSION })
check('不带 name 清除全部会话提示词', resetAll.statusCode === 202 && (textMap()?.size ?? 0) === 0, textMap() ? [...textMap()] : null)

const badLayer = await callJson(inventoryResetRoute, 'POST', { layer: 'bogus', sessionId: TEST_SESSION })
check('inventory/reset 非法 layer 返回 400', badLayer.statusCode === 400, badLayer.body)
const noSessionReset = await callJson(inventoryResetRoute, 'POST', { layer: 'session' })
check('inventory/reset 无会话时返回 409', noSessionReset.statusCode === 409, noSessionReset.body)
const sessionReset = await callJson(inventoryResetRoute, 'POST', { layer: 'session', sessionId: TEST_SESSION })
check('inventory/reset {layer:session} 返回 202', sessionReset.statusCode === 202, sessionReset.body)
const globalReset = await callJson(inventoryResetRoute, 'POST', { layer: 'global', sessionId: TEST_SESSION })
check('inventory/reset {layer:global} 无 configEditor 时返回 501', globalReset.statusCode === 501, globalReset.body)


await fiber.dispose()
check('卸载后 /embody 与 /ctx 注销', !commands.definitions.has('embody') && !commands.definitions.has('ctx'), [...commands.definitions.keys()].join(','))
await root.fiber.dispose()

// ── 6. 包资源（client / icon / locale）────────────────────────────────────
// 宿主（dsh-app-boot 的 readPluginMeta）用 Node ESM 解析器按 exports 取
// `<包名>/locale/<lang>.json` 与 `<包名>/icon`，所以这里用同一套解析验证。
const require = createRequire(new URL('../package.json', import.meta.url))
for (const specifier of ['agent-embodiment/client', 'agent-embodiment/icon', 'agent-embodiment/locale/en.json', 'agent-embodiment/locale/zh.json']) {
  let resolved
  try {
    resolved = require.resolve(specifier)
  } catch (error) {
    check(`exports 可解析 ${specifier}`, false, error.code)
    continue
  }
  check(`exports 可解析 ${specifier}`, existsSync(resolved), resolved)
}

for (const language of ['en', 'zh']) {
  const file = new URL(`../locale/${language}.json`, import.meta.url)
  let meta
  try {
    meta = JSON.parse(readFileSync(file, 'utf8')).meta
  } catch (error) {
    check(`locale/${language}.json 合法`, false, String(error))
    continue
  }
  check(
    `locale/${language}.json 有 meta.title/description`,
    typeof meta?.title === 'string' && meta.title.trim() !== '' && typeof meta?.description === 'string' && meta.description.trim() !== '',
    JSON.stringify(meta),
  )
}

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let clientParsed = true
try {
  new Function(clientSource)
} catch {
  clientParsed = false
}
check('client.js 语法可编译', clientParsed)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
check('dsh.client 声明合法', manifest.dsh?.client?.platform === 'web' && typeof manifest.dsh.client.immediately === 'boolean' && Array.isArray(manifest.dsh.client.inject), JSON.stringify(manifest.dsh?.client))
check('dsh.bundle.patch 指向存在的文件', existsSync(new URL(`../${manifest.dsh?.bundle?.patch ?? 'missing'}`, import.meta.url)))

// ── 7. 浏览器半侧：在 mock 的 __ModuleLoader__ 与 cordis 上下文里 apply ──────
const client = (() => {
  const loaded = loadClient(clientSource, { trackEffects: true })
  check('client.js 通过 __ModuleLoader__.load 注册', typeof loaded.registration?.factory === 'function', loaded.registration?.id)
  return loaded
})()
check('client exports inject = ["slots","locale"]', client.moduleExports.inject?.join(',') === 'slots,locale', JSON.stringify(client.moduleExports.inject))
check('client 注册词典', Object.keys(client.dictionaries).join(',') === 'agentEmbodiment', Object.keys(client.dictionaries).join(','))
client.slotInjects[0]?.callback()
const section = client.slotRegistrations[0]?.definition ?? {}
check('client 注册 settings.section', section.name === 'settings.section', JSON.stringify(section))
check('settings.section id/order/locale', section.id === 'agent-embodiment' && typeof section.order === 'number' && section.locale === 'agentEmbodiment', JSON.stringify(section))
check('settings.section label 走中文词典', section.label?.() === '上下文', section.label?.())
check('settings.section 组件是函数', typeof client.slotRegistrations[0]?.component === 'function', typeof client.slotRegistrations[0]?.component)

// ── 6b. 有 webServer 无 connection：状态路由失败关闭（403）────────────────────
{
  const solo = new Context()
  await solo.plugin(MockCommands)
  await solo.plugin(MockTokenMeter)
  await solo.plugin(MockWebServer)
  const soloFiber = solo.plugin(plugin, { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9 })
  await soloFiber
  await new Promise((resolve) => setTimeout(resolve, 0))
  const soloServer = solo.get('webServer')
  const soloRoute = soloServer?.routes?.get('/api/agent-embodiment/status')
  const denied = makeResponse()
  soloRoute?.handler({ method: 'GET', headers: {} }, denied)
  check('没有 connection 时状态路由 403（失败关闭）', denied.statusCode === 403 && String(denied.body) === 'forbidden', JSON.stringify({ code: denied.statusCode, body: denied.body }))
  try { await soloFiber.dispose() } catch {}
}


try {
  rmSync(testHome, { recursive: true, force: true })
} catch {}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[smoke] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[smoke] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exit(1)
}
