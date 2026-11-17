/**
 * Agent Embodiment Scaffold 的三条 HTTP 路由（模板列表 / 预览 / 生成）。
 *
 * 从 index.js 的 `apply()` 里抽出来（0.36.0）：这三个 handler 只依赖
 * 「路由工具 + 路径守卫 + scaffold.js 纯函数」，不碰插件的可变状态，
 * 抽出来后可以用假 request/response 直接单测，不需要构造 Cordis 上下文。
 *
 * 行为与抽取前逐字一致；差异只在依赖改为显式注入。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { SCAFFOLD_TEMPLATES, mergeAgentsContent, planScaffold } from './scaffold.js'

/** scaffold spec 的请求体上限（与抽取前一致）。 */
const SCAFFOLD_BODY_LIMIT = 64 * 1024

/**
 * 路径比较用的归一化：Windows 上大小写不敏感、且存在 8.3 短名（`PROGRA~1`）与
 * `\\?\` / `\\.\` 设备前缀。原先守卫是纯字符串前缀比较，实测 `c:\windows\system32`
 * 与 `C:\WINDOWS` 都能绕过（返回 false）。这里统一做三件事：
 *   1. 去掉 `\\?\` / `\\.\` 前缀；
 *   2. resolve 之后在 Windows 上转小写；
 *   3. 去掉尾部分隔符，避免 `C:\Windows\` 与 `C:\Windows` 被当成不同路径。
 */
function normalizeForCompare(input) {
  let text = String(input ?? '')
  if (text.startsWith('\\\\?\\')) text = text.slice(4)
  else if (text.startsWith('\\\\.\\')) text = text.slice(4)
  let resolved
  try {
    resolved = resolve(text)
  } catch {
    resolved = text
  }
  while (resolved.length > 1 && (resolved.endsWith(sep) || resolved.endsWith('/'))) {
    resolved = resolved.slice(0, -1)
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** `child` 等于 `parent` 或位于其下（两者都已归一化）。 */
function isAtOrUnder(child, parent) {
  const normalizedParent = normalizeForCompare(parent)
  if (child === normalizedParent) return true
  return child.startsWith(normalizedParent.endsWith(sep) ? normalizedParent : normalizedParent + sep)
}

/**
 * 把路径里**已存在的那一段**展开成真实长名（Windows 的 8.3 短名：`RUNNER~1`、`PROGRA~1`）。
 *
 * 为什么需要：目标目录通常还不存在，没法直接 realpath；但它的祖先往往存在，而短名只
 * 出现在祖先上。所以从目标往上找到第一个存在的祖先，realpath 它，再把剩下的段接回去。
 *
 * 附带效果：中间经过的 junction / 符号链接也会被解开 —— 对守卫是好事（链接指向
 * `C:\Windows` 时会展开成那里，照样判受保护）。
 *
 * 展开不了（不存在、权限不足、POSIX 上不需要）就返回 undefined，调用方据此按
 * 「无法确定真实目录」处理。
 */
function expandRealPath(input) {
  let cursor = String(input ?? '')
  if (cursor.length === 0) return undefined
  const tail = []
  while (cursor.length > 0 && !existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    tail.unshift(basename(cursor))
    cursor = parent
  }
  if (!existsSync(cursor)) return undefined
  try {
    const real = typeof realpathSync.native === 'function' ? realpathSync.native(cursor) : realpathSync(cursor)
    return tail.length > 0 ? join(real, ...tail) : real
  } catch {
    return undefined
  }
}

/**
 * 拒绝系统目录、home 及其祖先、DSH 配置目录和常见凭据目录。
 *
 * @param {string} root 已 resolve 的目标目录
 * @param {{ home: string, dshHome: string }} roots
 * @param {{ expand?: (path: string) => string | undefined }} [overrides] 仅供测试注入。
 */
export function isProtectedScaffoldPath(root, roots, overrides = {}) {
  const expand = typeof overrides.expand === 'function' ? overrides.expand : expandRealPath
  // Windows 上先展开 8.3 短名：`C:\Users\RUNNER~1\...` 是**合法且常见**的路径
  // （长用户名下的 TEMP 就是短名），不能因为它含 `~N` 就一律拒绝 —— 0.50.4 的
  // Windows CI 实测：runner 的 tmpdir 正是 `C:\Users\RUNNER~1\AppData\Local\Temp`，
  // 于是「生成到临时目录」被误判成受保护。展开失败仍然拒绝（宁可不放行）。
  const needsExpand = process.platform === 'win32' || typeof overrides.expand === 'function'
  const expandedRoot = needsExpand ? expand(String(root ?? '')) : String(root ?? '')
  const effectiveRoot = expandedRoot ?? String(root ?? '')
  const effectiveHome = needsExpand ? expand(roots.home) ?? roots.home : roots.home
  const effectiveDshHome = needsExpand ? expand(roots.dshHome) ?? roots.dshHome : roots.dshHome

  const home = normalizeForCompare(effectiveHome)
  const target = normalizeForCompare(effectiveRoot)
  const systemPrefixes = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var', '/root']
  const privateDirs = ['.ssh', '.gnupg', '.aws', '.kube', '.config', '.local'].map((name) => join(effectiveHome, name))
  // 盘符根 / 文件系统根（dirname(root) === root）：用展开后的路径，短名不影响盘的判断。
  if (dirname(String(effectiveRoot)) === String(effectiveRoot)) return true
  if (process.platform === 'win32') {
    const windowsDirs = [
      process.env.SystemRoot,
      process.env.windir,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ].filter((dir) => typeof dir === 'string' && dir.length > 0)
    if (windowsDirs.some((dir) => isAtOrUnder(target, dir))) return true
  }
  if (target === home) return true
  // 8.3 短名（PROGRA~1、WINDOW~1）只存在于 Windows。**展开成功时不再一律拒绝**：
  // 长用户名下的 TEMP 本身就是短名路径（CI 实测 `C:\Users\RUNNER~1\AppData\Local\Temp`），
  // 拒绝它等于让这类用户永远无法生成脚手架。只有**展开后仍然带 `~N`**（即无法确定
  // 真实目录）才按受保护处理。POSIX 上 `~1` 是合法字符，不做该判断。
  const stillShort = /(^|[\\/])[^\\/]{1,8}~\d/u.test(String(effectiveRoot))
  if (process.platform === 'win32' && stillShort) return true
  if (typeof overrides.expand === 'function' && stillShort) return true
  // home 的任意祖先（/home、C:\Users、C:\ 等）都不允许。
  let cursor = effectiveHome
  while (dirname(cursor) !== cursor) {
    cursor = dirname(cursor)
    if (target === normalizeForCompare(cursor)) return true
  }
  if (systemPrefixes.some((prefix) => isAtOrUnder(target, prefix))) return true
  if (isAtOrUnder(target, effectiveDshHome)) return true
  return privateDirs.some((dir) => isAtOrUnder(target, dir))
}

/**
 * @param {{
 *   home: string,
 *   dshHome: string,
 *   jsonSender: (response: any) => (status: number, body: any) => void,
 *   requireMethod: (request: any, response: any, method: string) => boolean,
 *   readJson: (request: any, response: any, onBody: (input: any) => void, limit?: number, message?: string) => void,
 * }} deps
 */
export function createScaffoldRoutes(deps) {
  const { home, dshHome, jsonSender, requireMethod, readJson } = deps
  const roots = { home, dshHome }

  const scaffoldTemplateList = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    return send(200, {
      ok: true,
      templates: SCAFFOLD_TEMPLATES.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        experimental: template.experimental === true,
        pattern: template.pattern,
        senses: template.senses,
        hands: template.hands,
      })),
    })
  }

  const scaffoldPreviewHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      try {
        const plan = planScaffold(input)
        return send(200, {
          ok: true,
          template: plan.template,
          presetId: plan.presetId,
          bundleDir: plan.bundleDir,
          spec: plan.spec,
          files: plan.files,
          warnings: plan.warnings,
          installCommand: plan.installCommand,
        })
      } catch (error) {
        return send(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }, SCAFFOLD_BODY_LIMIT, 'invalid scaffold spec')
  }

  const scaffoldGenerateHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      if (typeof input?.targetDir !== 'string' || !isAbsolute(input.targetDir.trim())) {
        return send(400, { ok: false, error: 'targetDir must be an absolute path' })
      }
      const root = resolve(input.targetDir.trim())
      if (isProtectedScaffoldPath(root, roots)) {
        return send(400, { ok: false, error: 'targetDir points at a protected location; choose a workspace directory' })
      }
      // 目标已存在时按真实路径再判一次：junction / symlink 可以让字符串前缀检查通过，
      // 但实际写入落在受保护目录里。
      if (existsSync(root)) {
        try {
          const real = realpathSync.native ? realpathSync.native(root) : realpathSync(root)
          if (isProtectedScaffoldPath(real, roots)) {
            return send(400, { ok: false, error: 'targetDir resolves to a protected location (symlink); choose a workspace directory' })
          }
        } catch {
          // 无法解析真实路径时继续按字符串判定结果处理
        }
      }
      let plan
      try {
        plan = planScaffold(input)
      } catch (error) {
        return send(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      const overwrite = input.overwrite === true
      const destinations = plan.files.map((file) => ({ ...file, destination: resolve(root, file.path) }))
      for (const file of destinations) {
        if (!file.destination.startsWith(root + sep)) {
          return send(400, { ok: false, error: `path escapes targetDir: ${file.path}` })
        }
      }
      const existing = destinations.filter((file) => existsSync(file.destination)).map((file) => file.path)
      if (existing.length > 0 && !overwrite) {
        return send(409, { ok: false, error: 'files already exist; pass overwrite:true to replace them', existing })
      }
      try {
        mkdirSync(root, { recursive: true })
        for (const file of destinations) {
          mkdirSync(dirname(file.destination), { recursive: true })
          writeFileSync(file.destination, file.content, 'utf8')
        }
      } catch (error) {
        return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      let agentsPath = null
      if (input.writeAgents === true) {
        try {
          agentsPath = join(root, plan.agents.path)
          const existingAgents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
          writeFileSync(agentsPath, mergeAgentsContent(existingAgents, plan.agents), 'utf8')
        } catch (error) {
          return send(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return send(202, {
        ok: true,
        targetDir: root,
        template: plan.template,
        presetId: plan.presetId,
        bundleDir: plan.bundleDir,
        files: plan.files.map((file) => file.path),
        agentsPath,
        warnings: plan.warnings,
        installCommand: `dsh plugin --profile <profile> add ${join(root, plan.bundleDir)}`,
      })
    }, SCAFFOLD_BODY_LIMIT, 'invalid scaffold spec')
  }

  return { scaffoldTemplateList, scaffoldPreviewHandler, scaffoldGenerateHandler }
}
