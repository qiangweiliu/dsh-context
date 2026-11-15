/**
 * Agent Embodiment Scaffold 的三条 HTTP 路由（模板列表 / 预览 / 生成）。
 *
 * 从 index.js 的 `apply()` 里抽出来（0.36.0）：这三个 handler 只依赖
 * 「路由工具 + 路径守卫 + scaffold.js 纯函数」，不碰插件的可变状态，
 * 抽出来后可以用假 request/response 直接单测，不需要构造 Cordis 上下文。
 *
 * 行为与抽取前逐字一致；差异只在依赖改为显式注入。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { SCAFFOLD_TEMPLATES, mergeAgentsContent, planScaffold } from './scaffold.js'

/** scaffold spec 的请求体上限（与抽取前一致）。 */
const SCAFFOLD_BODY_LIMIT = 64 * 1024

/**
 * 拒绝系统目录、home 及其祖先、DSH 配置目录和常见凭据目录。
 *
 * @param {string} root 已 resolve 的目标目录
 * @param {{ home: string, dshHome: string }} roots
 */
export function isProtectedScaffoldPath(root, roots) {
  const home = roots.home
  const dshHome = roots.dshHome
  const systemPrefixes = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var', '/root']
  const privateDirs = ['.ssh', '.gnupg', '.aws', '.kube', '.config', '.local'].map((name) => join(home, name))
  // Windows 没有 /etc、/usr；用盘符根 + 系统目录环境变量覆盖 C:\Windows、Program Files 等。
  if (dirname(root) === root) return true
  if (process.platform === 'win32') {
    const windowsDirs = [
      process.env.SystemRoot,
      process.env.windir,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ].filter((dir) => typeof dir === 'string' && dir.length > 0)
    if (windowsDirs.some((dir) => {
      const resolved = resolve(dir)
      return root === resolved || root.startsWith(resolved + sep)
    })) return true
  }
  if (root === home) return true
  // home 的任意祖先（/home、C:\Users、C:\ 等）都不允许。
  let cursor = home
  while (dirname(cursor) !== cursor) {
    cursor = dirname(cursor)
    if (root === cursor) return true
  }
  if (systemPrefixes.some((prefix) => root === resolve(prefix) || root.startsWith(resolve(prefix) + sep))) return true
  if (root === dshHome || root.startsWith(dshHome + sep)) return true
  return privateDirs.some((dir) => root === dir || root.startsWith(dir + sep))
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
