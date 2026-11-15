/**
 * 会话预算 / 数据清理 / 会话级提示词文本 / 新增提示词的 HTTP 路由。
 *
 * 0.37.0 从 index.js 的 `apply()` 里抽出（P1.4 步 1 第二块）。这些 handler 只依赖
 * 「路由工具 + state/persist 的具名函数」，不直接读闭包里的可变对象，因此可以用假
 * request/response 直接单测（`test/routes-session.mjs`）。
 *
 * 行为与抽取前逐字一致；差异只在依赖改为显式注入。
 */
import { existsSync } from 'node:fs'

/** 单条会话提示词文本上限（整份 session-toggles.json 每次重写并按份备份，需设上限）。 */
const MAX_SESSION_PROMPT_TEXT_BYTES = 32 * 1024

/**
 * @param {{
 *   jsonSender: Function,
 *   requireMethod: Function,
 *   readJson: Function,
 *   bumpStatusRevision: () => void,
 *   latestSessionId: () => string | undefined,
 *   setSessionBudget: (sessionId: string, tokens: number) => boolean,
 *   clearSessionBudget: (sessionId: string) => void,
 *   listSessionBudgets: () => Array<{ sessionId: string, tokens: number }>,
 *   hydrateCompactionLog: (entries: any[]) => void,
 *   compactionLogPath: string,
 *   atomicWriteFile: (path: string, data: string) => void,
 *   clearAllSessionToggles: () => number,
 *   saveSessionToggles: () => void,
 *   setSessionPromptText: (sessionId: string, name: string, text: string) => void,
 *   clearSessionPromptText: (sessionId: string, name?: string) => void,
 *   getExtraPrompts: () => Record<string, string>,
 *   getExtraPromptPlacements: () => Record<string, string>,
 *   writeExtraPrompts: (next: Record<string, string>, placements: Record<string, string>, response: any, send: Function) => void,
 * }} deps
 */
export function createSessionRoutes(deps) {
  const {
    jsonSender,
    requireMethod,
    readJson,
    bumpStatusRevision,
    latestSessionId,
    setSessionBudget,
    clearSessionBudget,
    listSessionBudgets,
    hydrateCompactionLog,
    compactionLogPath,
    atomicWriteFile,
    clearAllSessionToggles,
    saveSessionToggles,
    setSessionPromptText,
    clearSessionPromptText,
    getExtraPrompts,
    getExtraPromptPlacements,
    writeExtraPrompts,
  } = deps

  const sessionBudgetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return send(400, { ok: false, error: 'expected a JSON object' })
      }
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
      if (!sessionId) return send(400, { ok: false, error: 'sessionId is required' })
      const clear = input.tokens === null || input.tokens === 0 || input.tokens === undefined
      if (!clear && (!Number.isInteger(input.tokens) || input.tokens <= 0)) {
        return send(400, { ok: false, error: 'tokens must be a positive integer, or null to clear' })
      }
      // 清除走 clearSessionBudget（setSessionBudget 只接受正整数）；清除是幂等的，
      // 即使本来没有覆盖也返回成功，避免面板上「清除」按钮报错。
      if (clear) clearSessionBudget(sessionId)
      else if (!setSessionBudget(sessionId, input.tokens)) return send(400, { ok: false, error: 'could not update session budget' })
      bumpStatusRevision()
      return send(202, { ok: true, sessionId, tokens: clear ? null : input.tokens, sessionBudgets: listSessionBudgets() })
    })
  }

  const dataResetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const scope = input?.scope
      if (!['logs', 'toggles', 'all'].includes(scope)) return send(400, { ok: false, error: 'scope must be logs, toggles or all' })
      if (scope === 'logs' || scope === 'all') {
        hydrateCompactionLog([])
        try {
          if (existsSync(compactionLogPath)) atomicWriteFile(compactionLogPath, '')
        } catch {}
      }
      if (scope === 'toggles' || scope === 'all') {
        clearAllSessionToggles()
        saveSessionToggles()
      }
      return send(202, { ok: true, scope })
    })
  }

  const sessionPromptHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      if (typeof input?.name !== 'string' || input.name.length === 0 || typeof input.text !== 'string') return send(400, { ok: false, error: 'name/text are required' })
      if (Buffer.byteLength(input.text, 'utf8') > MAX_SESSION_PROMPT_TEXT_BYTES) {
        return send(400, { ok: false, error: `text is too large; limit is ${MAX_SESSION_PROMPT_TEXT_BYTES} bytes` })
      }
      const targetId = typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : latestSessionId()
      if (!targetId) return send(409, { ok: false, error: 'no session yet' })
      setSessionPromptText(targetId, input.name, input.text)
      saveSessionToggles()
      return send(202, { ok: true, layer: 'session', sessionId: targetId, name: input.name })
    })
  }

  const sessionPromptResetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const targetId = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : latestSessionId()
      if (!targetId) return send(409, { ok: false, error: 'no session yet' })
      clearSessionPromptText(targetId, typeof input?.name === 'string' && input.name.length > 0 ? input.name : undefined)
      saveSessionToggles()
      return send(202, { ok: true, layer: 'session', sessionId: targetId })
    })
  }

  const extraPromptHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      const text = input?.text
      const placement = input?.placement === undefined ? 'system' : input.placement
      if (name.length === 0 || name.length > 80) return send(400, { ok: false, error: 'name is required (max 80 chars)' })
      if (typeof text !== 'string') return send(400, { ok: false, error: 'text is required' })
      if (text.trim().length === 0) return send(400, { ok: false, error: 'text must not be empty' })
      if (placement !== 'system' && placement !== 'user') return send(400, { ok: false, error: "placement must be 'system' or 'user'" })
      const next = { ...getExtraPrompts(), [name]: text }
      const placements = { ...getExtraPromptPlacements() }
      if (placement === 'user') placements[name] = 'user'
      else delete placements[name]
      writeExtraPrompts(next, placements, response, send)
    })
  }

  const extraPromptResetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      const currentPrompts = getExtraPrompts()
      const currentPlacements = getExtraPromptPlacements()
      const next = name ? Object.fromEntries(Object.entries(currentPrompts).filter(([key]) => key !== name)) : {}
      const placements = name
        ? Object.fromEntries(Object.entries(currentPlacements).filter(([key]) => key !== name))
        : {}
      writeExtraPrompts(next, placements, response, send)
    })
  }

  return {
    sessionBudgetHandler,
    dataResetHandler,
    sessionPromptHandler,
    sessionPromptResetHandler,
    extraPromptHandler,
    extraPromptResetHandler,
  }
}
