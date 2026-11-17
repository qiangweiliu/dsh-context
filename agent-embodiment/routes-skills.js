/**
 * 技能（skill）读取路由：列出当前工作区的技能目录、取单个技能的正文。
 *
 * 0.49.0 新增。宿主把技能能力抽象成 `ctx.skills` 注册表（`@deepseek-ai/dsh-skill`），
 * 文件系统 provider（`dsh-skill-filesystem`）把磁盘上的 `SKILL.md` / `<name>.md`
 * 注册进去。注册表对外只有三个读方法：
 *
 *   - `list({ cwd, scope })`     → SkillSummary[]（按 name 排序，invocation 中性）
 *   - `snapshot({ cwd, scope })` → { skills, complete }（complete=false 表示有 provider 未完成）
 *   - `get(name, { cwd, scope })` → SkillDefinition（含 content 正文）
 *
 * 本模块**只读**：不写任何技能文件，也不改 invocation 策略。技能是否可以进模型/给用户调，
 * 由每个 SKILL.md 的 frontmatter（`disable-model-invocation` / `user-invocable`）决定，
 * 这里只如实展示。
 *
 * 为什么单独一个模块：路由只依赖「路由工具 + 一个 skills 句柄」，用假 request/response
 * 就能单测覆盖（含 provider 抛错、注册表缺失、名字非法等边界），不需要 Cordis。
 */

import { readdirSync, readFileSync as readFileText, statSync } from 'node:fs'
import { join } from 'node:path'

/** 技能名语法（kebab-case，与注册表内部的校验一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** 正文预览上限：SKILL.md 通常是几千字节，超出部分截断并标注，避免面板被单个文件拖死。 */
const MAX_BODY_CHARS = 200_000

/** 单次目录查询的超时：provider 可能在做文件系统扫描或远程拉取。 */
const SKILLS_TIMEOUT_MS = 8000

/**
 * 解析 SKILL.md 的 YAML frontmatter。只取主机侧真正会用来路由的四个字段，
 * 不做通用 YAML：技能 frontmatter 的形态是固定的扁量键值对，多余结构忽略。
 *
 * @param {string} text - 文件全文。
 * @param {string} fallbackName - 目录名（provider 用目录名做默认名）。
 * @returns {{ name: string, description: string, whenToUse: string | null, modelInvocable: boolean, userInvocable: boolean, body: string } | null}
 */
export function parseSkillFile(text, fallbackName) {
  if (typeof text !== 'string') return null
  const normalized = text.replace(/\r\n/gu, '\n')
  if (!normalized.startsWith('---')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return null
  const rawFrontmatter = normalized.slice(3, end)
  const body = normalized.slice(end + 4).replace(/^\n+/u, '')

  const fields = new Map()
  for (const line of rawFrontmatter.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    fields.set(key, value)
  }

  const name = fields.get('name') || fallbackName
  if (!SKILL_NAME.test(String(name))) return null
  const description = fields.get('description')
  if (!description) return null

  /** 宿主接受 YAML 布尔与 true/false、yes/no、on/off、1/0（大小写不敏感）。 */
  const readBoolean = (key, fallback) => {
    const raw = fields.get(key)
    if (raw === undefined || raw === '') return fallback
    const lowered = String(raw).toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(lowered)) return true
    if (['false', 'no', 'off', '0'].includes(lowered)) return false
    return fallback
  }

  return {
    name: String(name),
    description: String(description),
    whenToUse: fields.get('whenToUse') ? String(fields.get('whenToUse')) : null,
    // disable-model-invocation: true → 不进模型
    modelInvocable: !readBoolean('disable-model-invocation', false),
    userInvocable: readBoolean('user-invocable', true),
    body,
  }
}

/**
 * 按宿主 provider 的 rank 顺序计划要扫的根目录，并标注来源。
 * 顺序与 `dsh-skill-filesystem` 一致：project-dsh(100)、project-agents(200)、
 * user-dsh(400)、user-agents(500)。同名技能先到先得（rank 小的赢）。
 *
 * @param {{ cwd?: string, dshHome?: string, agentsHome?: string }} options
 * @returns {Array<{ source: string, dir: string, rank: number }>}
 */
export function planSkillRoots(options = {}) {
  const roots = []
  const push = (condition, source, dir, rank) => {
    if (!condition || typeof dir !== 'string' || dir.length === 0) return
    roots.push({ source, dir, rank })
  }
  const { cwd, dshHome, agentsHome } = options
  push(Boolean(cwd), 'project-dsh', cwd ? join(cwd, '.dsh', 'skills') : '', 100)
  push(Boolean(cwd), 'project-agents', cwd ? join(cwd, '.agents', 'skills') : '', 200)
  push(Boolean(dshHome), 'user-dsh', dshHome ? join(dshHome, 'skills') : '', 400)
  push(Boolean(agentsHome), 'user-agents', agentsHome ? join(agentsHome, 'skills') : '', 500)
  return roots.sort((left, right) => left.rank - right.rank)
}

/**
 * 扫描标准根目录。**这是注册表读不到时的兜底**：宿主的 provider 多数注册在
 * preset 作用域层，而插件是宿主平面，没有那个 scope key（`ScopeKey` 是
 * dsh-scope 的模块私有 Symbol），全局层读出的目录永远是空的。
 *
 * 只做「目录名/SKILL.md 或 <name>.md 的顶层扫描」，与宿主一致：不递归找嵌套
 * SKILL.md。同名技能按 rank 先到先得。
 *
 * @param {Array<{ source: string, dir: string, rank: number }>} roots
 * @param {{ listDir?: Function, readFile?: Function, statFile?: Function }} io - 便于单测注入
 * @returns {Array<object>}
 */
export function scanSkillRoots(roots, io = {}) {
  const listDir = io.listDir ?? ((dir) => readdirSync(dir, { withFileTypes: true }))
  const readFile = io.readFile ?? ((path) => readFileText(path, 'utf8'))
  const statFile = io.statFile ?? ((path) => statSync(path))

  const found = new Map()
  for (const root of roots) {
    let entries
    try {
      entries = listDir(root.dir)
    } catch {
      continue // 根目录不存在或不可读：跳过，不影响其它根
    }
    for (const entry of entries) {
      const dirName = typeof entry?.name === 'string' ? entry.name : String(entry)
      if (dirName.startsWith('.')) continue // 跳过 .system 之类的隐藏项
      const isDir = entry?.isDirectory ? entry.isDirectory() : false
      const isFile = entry?.isFile ? entry.isFile() : false
      const isLink = entry?.isSymbolicLink ? entry.isSymbolicLink() : false

      let filePath
      let fallbackName
      if (isDir) {
        filePath = join(root.dir, dirName, 'SKILL.md')
        fallbackName = dirName
      } else if (isLink) {
        // 符号链接在 Dirent 上既不是目录也不是文件（isDirectory 恒 false），
        // 必须 stat 一次才知道指向什么。用户常把技能目录软链到家目录。
        let target
        try {
          target = statFile(join(root.dir, dirName))
        } catch {
          continue // 悬空链接：跳过
        }
        if (target.isDirectory()) {
          filePath = join(root.dir, dirName, 'SKILL.md')
          fallbackName = dirName
        } else {
          if (!dirName.toLowerCase().endsWith('.md') || dirName.toLowerCase() === 'skill.md') continue
          filePath = join(root.dir, dirName)
          fallbackName = dirName.replace(/\.md$/iu, '')
        }
      } else if (isFile) {
        if (!dirName.toLowerCase().endsWith('.md') || dirName.toLowerCase() === 'skill.md') continue
        filePath = join(root.dir, dirName)
        fallbackName = dirName.replace(/\.md$/iu, '')
      } else {
        continue
      }

      let text
      try {
        text = readFile(filePath)
      } catch {
        continue
      }
      const parsed = parseSkillFile(text, fallbackName)
      if (!parsed) continue
      if (found.has(parsed.name)) continue // rank 小的先到先得
      found.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        whenToUse: parsed.whenToUse,
        source: root.source,
        provider: 'filesystem',
        path: filePath,
        modelInvocable: parsed.modelInvocable,
        userInvocable: parsed.userInvocable,
      })
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * @param {{
 *   jsonSender: (response: any) => (status: number, body: any) => void,
 *   requireMethod: (request: any, response: any, method: string) => boolean,
 *   requestUrl: (request: any) => URL,
 *   getSkills: () => any,
 *   getCwdForSession?: (sessionId: string) => string | null,
 *   defaultCwd?: () => string,
 *   logger?: (level: string, message: string) => void,
 *   timeoutMs?: number,
 * }} deps
 */
export function createSkillRoutes(deps) {
  const {
    jsonSender,
    requireMethod,
    requestUrl,
    getSkills,
    getCwdForSession,
    defaultCwd,
    logger,
    timeoutMs = SKILLS_TIMEOUT_MS,
    resolveHomes,
    scanRoots = scanSkillRoots,
    getScopeKey,
  } = deps

  const log = (message) => {
    if (typeof logger === 'function') logger('warn', message)
  }

  /**
   * 带超时的等待：注册表没有取消语义（我们拿不到调用方的 signal），
   * 至少不要让 HTTP 请求无限挂住。计时器**不能** unref，否则它可能永不触发、
   * 调用方就一直悬着。
   */
  const withTimeout = (task, ms) => new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`skill lookup took longer than ${ms}ms`))
    }, ms)
    Promise.resolve(task).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })

  /**
   * 解析本次查询的工作区：优先用 `?sessionId=` 指向的会话目录，其次 `?cwd=`，
   * 最后回落到默认工作目录。**不接受任意 cwd**——只有与会话关联的目录或进程默认目录
   * 参与扫描，避免把「读任意目录的技能」变成一个可枚举文件路径的接口。
   */
  const resolveCwd = (url) => {
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
    if (sessionId && typeof getCwdForSession === 'function') {
      const fromSession = getCwdForSession(sessionId)
      if (typeof fromSession === 'string' && fromSession.length > 0) return { cwd: fromSession, source: 'session' }
    }
    if (typeof defaultCwd === 'function') {
      const fallback = defaultCwd()
      if (typeof fallback === 'string' && fallback.length > 0) return { cwd: fallback, source: 'process' }
    }
    return { cwd: undefined, source: 'none' }
  }

  /** 把注册表的 SkillSummary 摊平成面板直接可用、且不泄漏额外字段的形状。 */
  const toRow = (skill) => ({
    name: skill?.name ?? null,
    description: typeof skill?.description === 'string' ? skill.description : '',
    whenToUse: typeof skill?.whenToUse === 'string' ? skill.whenToUse : null,
    source: typeof skill?.source === 'string' ? skill.source : null,
    provider: typeof skill?.provider === 'string' ? skill.provider : null,
    path: typeof skill?.path === 'string' ? skill.path : null,
    modelInvocable: skill?.invocation?.modelInvocable !== false,
    userInvocable: skill?.invocation?.userInvocable !== false,
  })

  /**
   * 取技能目录。优先用注册表（权威：含 runtime 注册与 preset 自定义目录），
   * 但插件是宿主平面，读不到 preset 作用域的 provider 层——那里的 `ScopeKey` 是
   * `dsh-scope` 的模块私有 Symbol，全局层读出的目录永远是空的。所以为空时按标准
   * 根目录扫盘兜底，并用 `via` 如实标注这次数据来自哪条路径。
   */
  const collectSkills = async (cwd) => {
    const homes = typeof resolveHomes === 'function' ? resolveHomes() : {}
    const scope = typeof getScopeKey === 'function' ? getScopeKey() : undefined
    const scopeApplied = Boolean(scope)
    const registry = getSkills()
    if (registry && typeof registry.snapshot === 'function') {
      const snapshot = await withTimeout(registry.snapshot(scope ? { cwd, scope } : { cwd }), timeoutMs)
      const rows = Array.isArray(snapshot?.skills) ? snapshot.skills.map(toRow) : []
      if (rows.length > 0) {
        return { via: 'registry', scopeApplied, complete: snapshot?.complete !== false, skills: rows }
      }
      const scanned = scanRoots(planSkillRoots({ cwd, ...homes }))
      return {
        via: scanned.length > 0 ? 'filesystem' : 'registry-empty',
        scopeApplied,
        complete: snapshot?.complete !== false,
        skills: scanned,
      }
    }
    const scanned = scanRoots(planSkillRoots({ cwd, ...homes }))
    return { via: scanned.length > 0 ? 'filesystem' : 'unavailable', scopeApplied, complete: true, skills: scanned }
  }

  const skillsHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    const url = requestUrl(request)
    const { cwd, source } = resolveCwd(url)
    return collectSkills(cwd)
      .then((collected) => {
        const skills = collected.skills
        send(200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          via: collected.via,
          scopeApplied: collected.scopeApplied === true,
          cwd: cwd ?? null,
          cwdSource: source,
          complete: collected.complete !== false,
          counts: {
            total: skills.length,
            model: skills.filter((item) => item.modelInvocable).length,
            user: skills.filter((item) => item.userInvocable).length,
          },
          skills,
        })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        log(`skills snapshot failed: ${message}`)
        send(500, { ok: false, error: message })
      })
  }

  const skillBodyHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    const url = requestUrl(request)
    const name = (url.searchParams.get('name') ?? '').trim()
    if (!SKILL_NAME.test(name)) {
      return send(400, { ok: false, error: 'name must be a kebab-case skill name' })
    }
    const { cwd, source } = resolveCwd(url)
    // 与列表响应同一个字段：正文也可能由扫盘路径产出，前端要能一致地判断视角是否完整。
    const scope = typeof getScopeKey === 'function' ? getScopeKey() : undefined
    const scopeApplied = Boolean(scope)

    /**
     * 与列表同一条取数路径：注册表能给就用注册表（权威正文），否则按目录扫描
     * 找到该技能的路径再读文件。两条路径都只读。
     */
    const loadBody = async () => {
      const registry = getSkills()
      if (registry && typeof registry.get === 'function') {
        const definition = await withTimeout(registry.get(name, scope ? { cwd, scope } : { cwd }), timeoutMs)
        if (definition) {
          const content = typeof definition.content === 'string' ? definition.content : ''
          return {
            via: 'registry',
            name: definition.name ?? name,
            description: typeof definition.description === 'string' ? definition.description : '',
            source: typeof definition.source === 'string' ? definition.source : null,
            provider: typeof definition.provider === 'string' ? definition.provider : null,
            path: typeof definition.path === 'string' ? definition.path : null,
            modelInvocable: definition?.invocation?.modelInvocable !== false,
            userInvocable: definition?.invocation?.userInvocable !== false,
            content,
          }
        }
      }
      const homes = typeof resolveHomes === 'function' ? resolveHomes() : {}
      const rows = scanRoots(planSkillRoots({ cwd, ...homes }))
      const match = rows.find((row) => row.name === name)
      if (!match) return null
      let text = ''
      try {
        text = readFileText(match.path, 'utf8')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`cannot read skill file: ${message}`)
      }
      const parsed = parseSkillFile(text, name)
      return {
        via: 'filesystem',
        name: match.name,
        description: match.description,
        source: match.source,
        provider: match.provider,
        path: match.path,
        modelInvocable: match.modelInvocable,
        userInvocable: match.userInvocable,
        // 正文取 frontmatter 之后的部分，与注册表返回的 content 语义一致
        content: parsed ? parsed.body : text,
      }
    }

    return loadBody()
      .then((loaded) => {
        if (!loaded) {
          return send(404, { ok: false, error: `skill not found: ${name}`, cwd: cwd ?? null })
        }
        const content = loaded.content
        const truncated = content.length > MAX_BODY_CHARS
        send(200, {
          ok: true,
          via: loaded.via,
          name: loaded.name,
          description: loaded.description,
          source: loaded.source,
          provider: loaded.provider,
          path: loaded.path,
          modelInvocable: loaded.modelInvocable,
          userInvocable: loaded.userInvocable,
          cwd: cwd ?? null,
          cwdSource: source,
          scopeApplied,
          truncated,
          chars: content.length,
          content: truncated ? content.slice(0, MAX_BODY_CHARS) : content,
        })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        log(`skill body failed for ${name}: ${message}`)
        send(500, { ok: false, error: message })
      })
  }

  return { skillsHandler, skillBodyHandler }
}