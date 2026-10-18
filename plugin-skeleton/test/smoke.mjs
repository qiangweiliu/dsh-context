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
 *   3. /ctx 注册成功、输出格式正确、参数覆盖上下文生效、非法参数返回 error
 *   4. 浏览器状态路由 /api/ctx-mon-and-con/status 注册、返回 JSON、非 GET 405
 *   5. 卸载插件后命令注销（disposer 生效）
 *   6. 包资源（client/icon/locale）能被 exports 解析，dsh.client 声明合法
 *   7. client.js 在 mock 的 __ModuleLoader__/cordis 上下文里能 apply 并注册 settings.section
 *
 * 运行：node test/smoke.mjs
 * 前提：test/deps/dsh/node_modules/@deepseek-ai/{cordis,cosmokit} 存在。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 测试用临时 HOME：plugin 的落盘只写临时目录，不碰真实用户 profile。
const testHome = mkdtempSync(join(tmpdir(), 'ctx-smoke-home-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

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


// ── 1. 合法插件形状 ───────────────────────────────────────────────────────
check('exports name', plugin.name === 'ctx-mon-and-con', plugin.name)
check('exports inject', Array.isArray(plugin.inject) && plugin.inject.join(',') === 'commands,tokenMeter', JSON.stringify(plugin.inject))
check('exports Config standard schema', typeof plugin.Config?.['~standard']?.validate === 'function')
check('exports apply function', typeof plugin.apply === 'function')

const root = new Context()
await root.plugin(MockCommands)
await root.plugin(MockTokenMeter)
await root.plugin(MockWebServer)
const commands = root.get('commands')
const webServer = root.get('webServer')

const fiber = root.plugin(plugin, { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9 })
await fiber

// ── 2. 命令注册 ───────────────────────────────────────────────────────────
const definition = commands.definitions.get('ctx')
check('/ctx registered', Boolean(definition), [...commands.definitions.keys()].join(','))
check('/ctx has input hint', definition?.input?.hint === '[tokens|reset]', definition?.input?.hint)

const agent = { session: { id: 'smoke-session' } }
const invoke = async (rawInput = '') => {
  const outcome = await definition.handler({ commandId: 'cmd-smoke', agent, rawInput, signal: new AbortController().signal })
  return outcome
}

// ── 3. 输出与参数 ─────────────────────────────────────────────────────────
const normal = await invoke()
check('/ctx 正常输出 success', normal.kind === 'success', normal.text)
check('/ctx 显示总用量', normal.text?.includes('42,350'), normal.text)
check('/ctx 显示上下文', normal.text?.includes('128,000'), normal.text)
check('/ctx 显示百分比与状态', normal.text?.includes('33.1%') && normal.text?.includes('ok'), normal.text)

const warned = await invoke('48000')
check('/ctx 参数覆盖上下文', warned.kind === 'success' && warned.text?.includes('48,000'), warned.text)
check('/ctx 到达 warnAt 标记警告', warned.text?.includes('88.2%') && warned.text?.includes('警告'), warned.text)

const over = await invoke('40000')
check('/ctx 超过 errorAt 标记超限', over.text?.includes('105.9%') && over.text?.includes('超限'), over.text)

const bad = await invoke('abc')
check('/ctx 非法参数返回 error', bad.kind === 'error' && bad.text?.includes('/ctx'), bad.text)

const reset = await invoke('reset')
check('/ctx reset 清除会话覆盖', reset.kind === 'success' && reset.text?.includes('128,000'), reset.text)
const resetAgain = await invoke('reset')
check('/ctx reset 无覆盖时说明使用默认', resetAgain.kind === 'success' && resetAgain.text?.includes('没有临时上下文'), resetAgain.text)

const cancelled = await definition.handler({ commandId: 'c', agent, rawInput: '', signal: AbortSignal.abort() })
check('/ctx 已取消信号返回 error', cancelled.kind === 'error', cancelled.text)

// ── 3b. 浏览器状态路由（client.js 的数据源）────────────────────────────────
await new Promise((resolve) => setTimeout(resolve, 0))
const statusRoute = webServer.routes.get('/api/ctx-mon-and-con/status')
check('注册状态路由 /api/ctx-mon-and-con/status', statusRoute?.kind === 'exact', statusRoute?.path)
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
check('状态含最近测量', statusPayload.measurements?.[0]?.id === 'smoke-session', JSON.stringify(statusPayload.measurements))
check('状态含会话上下文列表（reset 后为空）', Array.isArray(statusPayload.sessionBudgets) && statusPayload.sessionBudgets.length === 0, JSON.stringify(statusPayload.sessionBudgets))
check('状态含控制状态（未挂控制行 = 未激活）', statusPayload.control?.active === false, JSON.stringify(statusPayload.control))
check('状态含压缩记录数组', Array.isArray(statusPayload.control?.log), JSON.stringify(statusPayload.control?.log))

// 压缩记录落盘：state 事件 -> 宿主订阅 -> JSONL 文件（写入临时 HOME）
const stateModule = await import(new URL('../state.js', import.meta.url).href)
stateModule.recordCompactionEvent({ outcome: 'success', trigger: 'manual', sessionId: 'smoke-session', before: 150000, after: 50000, budget: 128000, rounds: 1 })
const compactionLogPath = join(testHome, '.dsh', 'ctx-mon-and-con', 'compaction-log.jsonl')
const compactionLogLines = existsSync(compactionLogPath) ? readFileSync(compactionLogPath, 'utf8').trim().split('\n').filter(Boolean) : []
check('压缩事件落盘 JSONL（宿主订阅）', compactionLogLines.length === 1 && JSON.parse(compactionLogLines[0]).outcome === 'success' && JSON.parse(compactionLogLines[0]).after === 50000, JSON.stringify(compactionLogLines))
const logResponse = makeResponse()
statusRoute?.handler({ method: 'GET' }, logResponse)
const logPayload = logResponse.body ? JSON.parse(logResponse.body) : {}
check('status 返回刚写入的压缩记录', Array.isArray(logPayload.control?.log) && logPayload.control.log.some((entry) => entry.outcome === 'success' && entry.after === 50000), JSON.stringify(logPayload.control?.log))
const methodResponse = makeResponse()
statusRoute?.handler({ method: 'POST' }, methodResponse)
check('状态路由非 GET 返回 405', methodResponse.statusCode === 405, methodResponse.statusCode)

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

// ── 5. 卸载清理 ───────────────────────────────────────────────────────────
await fiber.dispose()
check('卸载后 /ctx 注销', !commands.definitions.has('ctx'), [...commands.definitions.keys()].join(','))
await root.fiber.dispose()

// ── 6. 包资源（client / icon / locale）────────────────────────────────────
// 宿主（dsh-app-boot 的 readPluginMeta）用 Node ESM 解析器按 exports 取
// `<包名>/locale/<lang>.json` 与 `<包名>/icon`，所以这里用同一套解析验证。
const require = createRequire(new URL('../package.json', import.meta.url))
for (const specifier of ['ctx-mon-and-con/client', 'ctx-mon-and-con/icon', 'ctx-mon-and-con/locale/en.json', 'ctx-mon-and-con/locale/zh.json']) {
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
  let registration
  const dictionaries = {}
  const effects = []
  const slotInjects = []
  const slotRegistrations = []
  const react = {
    createElement: () => null,
    Fragment: Symbol('Fragment'),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const require = (specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  }
  // 宿主浏览器壳就是这么跑 bundle 的：先执行文件注册 factory，再物化模块。
  new Function('window', 'require', clientSource)(fakeWindow, require)
  check('client.js 通过 __ModuleLoader__.load 注册', typeof registration?.factory === 'function', registration?.id)
  const moduleExports = registration.factory(require)
  const ctx = {
    effect(execute, label) {
      effects.push({ label, dispose: execute() })
    },
    locale: {
      register(namespace, values) {
        dictionaries[namespace] = values
        return () => delete dictionaries[namespace]
      },
      bind(namespace) {
        // 真实 locale.bind 按当前 UI 语言挑词典；这里固定中文以验证 zh 词典。
        return (key) => dictionaries[namespace]?.zh?.[key] ?? dictionaries[namespace]?.en?.[key] ?? key
      },
    },
    slots: {
      inject(name, callback) {
        slotInjects.push({ name, callback })
      },
      register(definition, component) {
        slotRegistrations.push({ definition, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)
  return { moduleExports, registration, effects, slotInjects, slotRegistrations, dictionaries }
})()
check('client exports inject = ["slots","locale"]', client.moduleExports.inject?.join(',') === 'slots,locale', JSON.stringify(client.moduleExports.inject))
check('client 注册词典', Object.keys(client.dictionaries).join(',') === 'ctxMonAndCon', Object.keys(client.dictionaries).join(','))
client.slotInjects[0]?.callback()
const section = client.slotRegistrations[0]?.definition ?? {}
check('client 注册 settings.section', section.name === 'settings.section', JSON.stringify(section))
check('settings.section id/order/locale', section.id === 'ctx-mon-and-con' && typeof section.order === 'number' && section.locale === 'ctxMonAndCon', JSON.stringify(section))
check('settings.section label 走中文词典', section.label?.() === '上下文长度', section.label?.())
check('settings.section 组件是函数', typeof client.slotRegistrations[0]?.component === 'function', typeof client.slotRegistrations[0]?.component)

try {
  rmSync(testHome, { recursive: true, force: true })
} catch {}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[smoke] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[smoke] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exit(1)
}
