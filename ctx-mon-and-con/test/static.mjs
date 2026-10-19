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
import { loadClient } from './client-harness.mjs'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}

const plugin = await import(new URL('../index.js', import.meta.url).href)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ── 1b. DSH STORE manifest 契约（兼容性声明 / 生命周期脚本 / 分发文件）──────
check('manifest 声明 engines.node', typeof manifest.engines?.node === 'string' && manifest.engines.node.trim() !== '', JSON.stringify(manifest.engines))
check('manifest 声明 engines.dsh（DSH 兼容范围）', typeof manifest.engines?.dsh === 'string' && manifest.engines.dsh.trim() !== '', JSON.stringify(manifest.engines))
const releases = manifest.dsh?.compatibility?.dshReleases
check(
  'manifest 声明 dsh.compatibility.dshReleases（逐版本精确记录）',
  releases && typeof releases === 'object' && Object.values(releases).every((value) => ['compatible', 'unknown', 'failed'].includes(value)),
  JSON.stringify(releases),
)
check(
  'manifest 未声明安装生命周期脚本',
  !manifest.scripts || !Object.keys(manifest.scripts).some((name) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)),
  JSON.stringify(manifest.scripts ?? null),
)
check(
  'manifest files 分发全部运行文件',
  ['index.js', 'control.js', 'state.js', 'metrics.js', 'client.js', 'dsh.bundle.patch.yml'].every((file) => Array.isArray(manifest.files) && manifest.files.includes(file)),
  JSON.stringify(manifest.files),
)
check('manifest 无 npm 运行依赖（只依赖宿主服务与 Node 内置模块）', !manifest.dependencies || Object.keys(manifest.dependencies).length === 0, JSON.stringify(manifest.dependencies ?? {}))
check('manifest 声明权限说明文档已分发', Array.isArray(manifest.files) && manifest.files.includes('PERMISSIONS.md'))

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
const triggerValid = validate({ triggerAt: 0.75 })
check('triggerAt 接受 (0, 1] 内的值', !triggerValid.issues && triggerValid.value?.triggerAt === 0.75, JSON.stringify(triggerValid))
const triggerInvalid = validate({ triggerAt: 1.5 })
check('triggerAt 超出 (0, 1] 被拒绝', Array.isArray(triggerInvalid.issues) && triggerInvalid.issues.length > 0, JSON.stringify(triggerInvalid.issues))
const targetDefault = validate({})
check('targetAt 默认 0.6', targetDefault.value?.targetAt === 0.6, JSON.stringify(targetDefault.value?.targetAt))
const targetInvalid = validate({ targetAt: 1 })
check('targetAt 必须小于 1', Array.isArray(targetInvalid.issues) && targetInvalid.issues.length > 0, JSON.stringify(targetInvalid.issues))
const keepTokensValid = validate({ keepTokens: 300 })
check('keepTokens 接受非负整数', !keepTokensValid.issues && keepTokensValid.value?.keepTokens === 300, JSON.stringify(keepTokensValid))
const keepTokensInvalid = validate({ keepTokens: -1 })
check('keepTokens 负数被拒绝', Array.isArray(keepTokensInvalid.issues) && keepTokensInvalid.issues.length > 0, JSON.stringify(keepTokensInvalid.issues))
const extraValid = validate({ extraPrompts: { 'project-rules': 'extra text' } })
check('extraPrompts 接受 name -> text', !extraValid.issues && extraValid.value?.extraPrompts?.['project-rules'] === 'extra text', JSON.stringify(extraValid))
const extraInvalid = validate({ extraPrompts: [] })
check('extraPrompts 拒绝数组', Array.isArray(extraInvalid.issues) && extraInvalid.issues.length > 0, JSON.stringify(extraInvalid.issues))
const placementValid = validate({ extraPrompts: { 'project-rules': 'extra text' }, extraPromptPlacements: { 'project-rules': 'user' } })
check('extraPromptPlacements 接受 user', !placementValid.issues && placementValid.value?.extraPromptPlacements?.['project-rules'] === 'user', JSON.stringify(placementValid))
const placementInvalid = validate({ extraPromptPlacements: { 'project-rules': 'bad' } })
check('extraPromptPlacements 拒绝非法位置', Array.isArray(placementInvalid.issues) && placementInvalid.issues.length > 0, JSON.stringify(placementInvalid.issues))
const targetAboveTrigger = validate({ triggerAt: 0.8, targetAt: 0.9 })
check('targetAt >= triggerAt 被拒绝', Array.isArray(targetAboveTrigger.issues) && targetAboveTrigger.issues.length > 0, JSON.stringify(targetAboveTrigger.issues))

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
check(
  'control 默认配置带默认值',
  !controlDefault.issues && controlDefault.value?.mode === 'idle' && controlDefault.value?.maxContextTokens === 0 && controlDefault.value?.maxAttempts === 2,
  JSON.stringify(controlDefault),
)
const controlBadMode = controlValidate({ mode: 'nope' })
check('control 非法 mode 被拒绝', Array.isArray(controlBadMode.issues) && controlBadMode.issues.some((issue) => issue.path?.join('.') === 'mode'), JSON.stringify(controlBadMode.issues))
const controlBadBudget = controlValidate({ maxContextTokens: -1 })
check('control 负上下文被拒绝', Array.isArray(controlBadBudget.issues) && controlBadBudget.issues.some((issue) => issue.path?.join('.') === 'maxContextTokens'), JSON.stringify(controlBadBudget.issues))
const controlBadAttempts = controlValidate({ maxAttempts: 0 })
check('control maxAttempts 越界被拒绝', Array.isArray(controlBadAttempts.issues) && controlBadAttempts.issues.some((issue) => issue.path?.join('.') === 'maxAttempts'), JSON.stringify(controlBadAttempts.issues))
const controlBadKey = controlValidate({ nope: 1 })
check('control 未知配置键被拒绝', Array.isArray(controlBadKey.issues) && controlBadKey.issues.length > 0, JSON.stringify(controlBadKey.issues))

// ── 4. manifest 与 bundle patch 结构 ───────────────────────────────────────
check('dsh.client 声明合法', manifest.dsh?.client?.platform === 'web' && typeof manifest.dsh.client.immediately === 'boolean' && Array.isArray(manifest.dsh.client.inject), JSON.stringify(manifest.dsh?.client))
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
  const loaded = loadClient(clientSource, {
    onConfigForms: () => checks.push({ name: '不再使用 configForms（改为宿主配置路由）', ok: false, detail: 'unexpected call' }),
  })
  check('client.js 通过 __ModuleLoader__.load 注册', typeof loaded.registration?.factory === 'function', loaded.registration?.id)
  return loaded
})()
check('client exports inject', client.moduleExports.inject?.join(',') === 'slots,locale', JSON.stringify(client.moduleExports.inject))
for (const inject of client.slotInjects) inject.callback()

const bySlot = (name) => client.slotRegistrations.find((entry) => entry.definition.name === name) ?? {}
const section = bySlot('settings.section').definition ?? {}
check('client 注册 settings.section', section.name === 'settings.section', JSON.stringify(section))
check('settings.section id/order/locale', section.id === 'ctx-mon-and-con' && typeof section.order === 'number' && section.locale === 'ctxMonAndCon', JSON.stringify(section))
check('settings.section label 走中文词典', section.label?.() === '上下文长度', section.label?.())
check('settings.section 组件是函数', typeof bySlot('settings.section').component === 'function', typeof bySlot('settings.section').component)

const mainEntry = bySlot('main').definition ?? {}
check('client 注册 main 整页', mainEntry.name === 'main' && mainEntry.key === 'ctx', JSON.stringify(mainEntry))
check('main 页组件是函数', typeof bySlot('main').component === 'function', typeof bySlot('main').component)

const panelEntry = bySlot('sidebar.panellist').definition ?? {}
check('client 注册 sidebar.panellist', panelEntry.name === 'sidebar.panellist' && panelEntry.id === 'ctx', JSON.stringify(panelEntry))
check('sidebar.panellist 标题是 ctx', panelEntry.label?.() === 'ctx', panelEntry.label?.())
const dockEntry = bySlot('conversation.composer.dock').definition ?? {}
check('client 注册 composer dock 指示器', dockEntry.name === 'conversation.composer.dock' && dockEntry.id === 'ctx-usage', JSON.stringify(dockEntry))
check('dock 指示器组件是函数', typeof bySlot('conversation.composer.dock').component === 'function', typeof bySlot('conversation.composer.dock').component)
const balanceEntry = client.slotRegistrations.find((entry) => entry.definition.id === 'ctx-balance')?.definition ?? {}
check('client 注册 DSH 余额 dock 胶囊', balanceEntry.name === 'conversation.composer.dock' && balanceEntry.order > dockEntry.order, JSON.stringify(balanceEntry))
check('余额胶囊使用 data-ctx-balance 标记', clientSource.includes("'data-ctx-balance': '1'"))
check('余额弹层使用 data-ctx-balance-panel 标记', clientSource.includes("'data-ctx-balance-panel': '1'"))
check('余额胶囊默认关闭、开关可持久化', clientSource.includes("ctx-mon-and-con:balance-enabled:v1") && clientSource.includes("'data-ctx-balance-toggle': '1'"))
check('余额视图区分 status:failed（不再一直显示加载中）', clientSource.includes("value.status === 'failed'"))
check('余额视图带充值入口与平台链接', clientSource.includes('links.topUpUrl') && clientSource.includes('links.usageUrl'))
check('余额重读有最小间隔', clientSource.includes('BALANCE_READ_MIN_MS = 30000'))
check('提示词来源从 inventory.sources 读（曾错读顶层 sources 而恒显示未识别）', clientSource.includes('data.inventory && data.inventory.sources'))
check('sidebar.panellist 图标组件是函数', typeof bySlot('sidebar.panellist').component === 'function', typeof bySlot('sidebar.panellist').component)

const stateModule = await import(new URL('../state.js', import.meta.url).href)
check('state 导出压缩记录接口', ['recordCompactionEvent', 'listCompactionLog', 'hydrateCompactionLog', 'subscribeCompactionLog'].every((name) => typeof stateModule[name] === 'function'))
check('client 含可折叠压缩记录容器', clientSource.includes('data-ctx-compact-log') && clientSource.includes('data-ctx-log-toggle'))

const failed = checks.filter((entry) => !entry.ok)
console.log(`\n[static] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[static] 失败项：${failed.map((entry) => entry.name).join('；')}`)
  process.exit(1)
}
