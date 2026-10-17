/**
 * 纯离线静态检查（不依赖 Cordis、不需要先解包 app.asar）。
 *
 * 覆盖：模块导出形状、Config 的 Standard Schema 校验、包资源能否被 exports 解析、
 * locale 元数据、bundle patch 的结构、client.js 能否在 mock 的
 * __ModuleLoader__/cordis 上下文里 apply 并注册 settings.section。
 *
 * 运行：node test/static.mjs
 * 需要真实 Cordis 的集成测试见 test/smoke.mjs（需先准备 test/deps）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}

const plugin = await import(new URL('../index.js', import.meta.url).href)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ── 1. 插件导出形状 ────────────────────────────────────────────────────────
check('exports name 是字符串', typeof plugin.name === 'string' && plugin.name.length > 0, plugin.name)
check('exports inject 是字符串数组', Array.isArray(plugin.inject) && plugin.inject.every((value) => typeof value === 'string'), JSON.stringify(plugin.inject))
check('exports apply 是函数', typeof plugin.apply === 'function')
check('exports Config 是 Standard Schema', typeof plugin.Config?.['~standard']?.validate === 'function')

const validate = plugin.Config['~standard'].validate

// ── 2. Config 校验（同步 Standard Schema，Cordis 的 resolveConfig 就调它）──
const valid = validate({})
check('空配置通过并带默认值', !valid.issues && valid.value?.contextWindowTokens === 128000 && valid.value?.warnAt === 0.75, JSON.stringify(valid))
const wrongType = validate({ contextWindowTokens: '200000' })
check('类型错误被拒绝', Array.isArray(wrongType.issues) && wrongType.issues.length > 0, JSON.stringify(wrongType.issues))
const unknown = validate({ nope: 1 })
check('未知配置键被拒绝', Array.isArray(unknown.issues) && unknown.issues.some((issue) => issue.path?.join('.') === 'nope'), JSON.stringify(unknown.issues))
const inverted = validate({ warnAt: 0.95, errorAt: 0.9 })
check('warnAt >= errorAt 被拒绝', Array.isArray(inverted.issues) && inverted.issues.length > 0, JSON.stringify(inverted.issues))

// ── 3. 包资源解析（宿主 readPluginMeta / client-modules 都走 ESM 解析器）──
const require = createRequire(new URL('../package.json', import.meta.url))
for (const specifier of ['ctx-mon-and-con/client', 'ctx-mon-and-con/control', 'ctx-mon-and-con/icon', 'ctx-mon-and-con/locale/en.json', 'ctx-mon-and-con/locale/zh.json']) {
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
  let meta
  try {
    meta = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8')).meta
  } catch (error) {
    check(`locale/${language}.json 合法`, false, String(error))
    continue
  }
  check(`locale/${language}.json 有 meta.title/description`, typeof meta?.title === 'string' && meta.title.trim() !== '' && typeof meta?.description === 'string' && meta.description.trim() !== '', JSON.stringify(meta))
}

// ── 3b. 控制半侧（preset 平面）——零依赖 ESM，可直接 import 验证形状 ──
const control = await import(new URL('../control.js', import.meta.url))
check(
  'control 导出 name/inject/Config/apply',
  control.name === 'ctx-mon-and-con-control' &&
    control.inject?.join(',') === 'tokenMeter' &&
    typeof control.Config?.['~standard']?.validate === 'function' &&
    typeof control.apply === 'function',
  `${control.name} / ${control.inject}`,
)
const controlValidate = control.Config['~standard'].validate
const controlDefault = controlValidate({})
check('control 默认配置带默认值', !controlDefault.issues && controlDefault.value?.mode === 'idle' && controlDefault.value?.maxContextTokens === 100000, JSON.stringify(controlDefault))
const controlBadMode = controlValidate({ mode: 'nope' })
check('control 非法 mode 被拒绝', Array.isArray(controlBadMode.issues) && controlBadMode.issues.some((issue) => issue.path?.join('.') === 'mode'), JSON.stringify(controlBadMode.issues))
const controlBadKey = controlValidate({ nope: 1 })
check('control 未知配置键被拒绝', Array.isArray(controlBadKey.issues) && controlBadKey.issues.length > 0, JSON.stringify(controlBadKey.issues))

// ── 4. manifest 与 bundle patch 结构 ───────────────────────────────────────check('dsh.client 声明合法', manifest.dsh?.client?.platform === 'web' && typeof manifest.dsh.client.immediately === 'boolean' && Array.isArray(manifest.dsh.client.inject), JSON.stringify(manifest.dsh?.client))
check('dsh.bundle.patch 指向存在的文件', existsSync(new URL(`../${manifest.dsh?.bundle?.patch ?? 'missing'}`, import.meta.url)))
const patch = readFileSync(new URL('../dsh.bundle.patch.yml', import.meta.url), 'utf8')
check('bundle patch 含 insert 层', /^- insert:/m.test(patch))
check('bundle patch 插入 id/name', /- id: ctx-mon-and-con\s*\n\s*name: ctx-mon-and-con/.test(patch))
const icon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
check('icon.svg 是 SVG 且体积极小', icon.trimStart().startsWith('<svg') && Buffer.byteLength(icon) <= 256 * 1024, `${Buffer.byteLength(icon)}B`)

// ── 5. 浏览器半侧：mock __ModuleLoader__ + cordis 上下文 ───────────────────
const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
check('client.js 语法可编译', (() => {
  try {
    new Function(clientSource)
    return true
  } catch {
    return false
  }
})())
const client = (() => {
  let registration
  const dictionaries = {}
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
  new Function('window', 'require', clientSource)(fakeWindow, require)
  check('client.js 通过 __ModuleLoader__.load 注册', typeof registration?.factory === 'function', registration?.id)
  const moduleExports = registration.factory(require)
  const ctx = {
    effect(execute) {
      execute()
    },
    locale: {
      register(namespace, values) {
        dictionaries[namespace] = values
        return () => delete dictionaries[namespace]
      },
      bind(namespace) {
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
  return { moduleExports, slotInjects, slotRegistrations, dictionaries }
})()
check('client exports inject = ["slots","locale"]', client.moduleExports.inject?.join(',') === 'slots,locale', JSON.stringify(client.moduleExports.inject))
client.slotInjects[0]?.callback()
const section = client.slotRegistrations[0]?.definition ?? {}
check('client 注册 settings.section', section.name === 'settings.section', JSON.stringify(section))
check('settings.section id/order/locale', section.id === 'ctx-mon-and-con' && typeof section.order === 'number' && section.locale === 'ctxMonAndCon', JSON.stringify(section))
check('settings.section label 走中文词典', section.label?.() === '上下文', section.label?.())
check('settings.section 组件是函数', typeof client.slotRegistrations[0]?.component === 'function', typeof client.slotRegistrations[0]?.component)

const failed = checks.filter((entry) => !entry.ok)
console.log(`\n[static] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[static] 失败项：${failed.map((entry) => entry.name).join('；')}`)
  process.exit(1)
}
