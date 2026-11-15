/**
 * inventory 相关路由：读取装配清单、按会话/全局开关工具与提示词、重置、提示词文本编辑。
 *
 * 0.43.0 从 index.js 的 `apply()` 抽出（P1.4 的延续）。这一组依赖较多但都是具名函数，
 * 抽出来后 `apply()` 只剩装配与注册；同时 `withLivePromptState` 这类「把落盘覆盖叠加到
 * 上次装配快照上」的纯逻辑可以单独验证。
 *
 * 行为与抽取前一致：错误码、`note` 文案、全局层只支持工具、提示词只支持会话层。
 */

/** 单条提示词文本上限：整份 session-toggles.json 会随每次写入重写并按份备份，不设限会被放大 30 倍。 */
const MAX_PROMPT_TEXT_BYTES = 32 * 1024

/**
 * @param {{
 *   jsonSender: Function,
 *   requireMethod: Function,
 *   readJson: Function,
 *   requestUrl: (request: any) => URL,
 *   runtime: any,
 *   latestSessionId: () => string | undefined,
 *   getInventory: (sessionId: string) => any,
 *   sourcesFor: (inventory: any) => any,
 *   getSessionPromptTextMap: (sessionId: string) => Map<string, string> | null,
 *   getSessionDisabledTools: (sessionId: string) => string[],
 *   getSessionDisabledPrompts: (sessionId: string) => string[],
 *   getAppliedTools: (sessionId: string) => any,
 *   setSessionToolEnabled: (sessionId: string, name: string, enabled: boolean) => void,
 *   setSessionPromptEnabled: (sessionId: string, name: string, enabled: boolean) => void,
 *   clearSessionToggles: (sessionId: string) => void,
 *   saveSessionToggles: () => void,
 *   setGlobalDisabledTools: (tools: string[]) => void,
 *   setGlobalPromptOverrides: (value: Record<string, string>) => void,
 *   setGlobalExtraPrompts: (value: Record<string, string>) => void,
 *   setGlobalExtraPromptPlacements: (value: Record<string, string>) => void,
 *   queuePromptWrite: (task: () => Promise<any>) => any,
 *   writePromptOverrides: (next: Record<string, string>, response: any, send: Function) => void,
 *   promptTemplates: any,
 *   log: (level: string, message: string) => void,
 * }} deps
 */
export function createInventoryRoutes(deps) {
  const {
    jsonSender,
    requireMethod,
    readJson,
    requestUrl,
    runtime,
    latestSessionId,
    getInventory,
    sourcesFor,
    getSessionPromptTextMap,
    getSessionDisabledTools,
    getSessionDisabledPrompts,
    getAppliedTools,
    setSessionToolEnabled,
    setSessionPromptEnabled,
    clearSessionToggles,
    saveSessionToggles,
    setGlobalDisabledTools,
    setGlobalPromptOverrides,
    setGlobalExtraPrompts,
    setGlobalExtraPromptPlacements,
    queuePromptWrite,
    writePromptOverrides,
    promptTemplates,
    log,
  } = deps

  /**
   * 把「已落盘的覆盖」叠加到上次装配快照上。
   * 会话层覆盖优先于全局层；两者都没有时保留快照里的文本。
   */
  const withLivePromptState = (inventory, sessionId) => {
    if (!inventory || !Array.isArray(inventory.sections)) return inventory
    const sessionTexts = sessionId ? getSessionPromptTextMap(sessionId) : null
    const overrides = runtime.getPromptOverrides()
    const sections = inventory.sections.map((section) => {
      const globalOverridden = Object.prototype.hasOwnProperty.call(overrides, section.name)
      const sessionOverridden = Boolean(sessionTexts && sessionTexts.has(section.name))
      const text = sessionOverridden
        ? String(sessionTexts.get(section.name))
        : globalOverridden
          ? String(overrides[section.name])
          : section.text
      return {
        ...section,
        text,
        overridden: Boolean(section.overridden || globalOverridden || sessionOverridden),
        globalOverridden,
        sessionOverridden,
      }
    })
    return { ...inventory, sections }
  }

  const findConfigEntry = () => {
    const editor = runtime.getConfigEditor()
    const entry = editor && typeof editor.entries === 'function'
      ? editor.entries().find((candidate) => candidate?.options?.id === 'agent-embodiment')
      : undefined
    if (!editor || typeof editor.edit !== 'function' || !entry) return null
    return { editor, entry }
  }

  const inventoryHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    const requested = requestUrl(request).searchParams.get('sessionId') ?? ''
    const sessions = runtime.getSessions()
    const session = requested && sessions && typeof sessions.get === 'function' ? sessions.get(requested) : latestSessionId()
    const sessionId = requested || session?.id
    return send(200, {
      ok: true,
      sessionId,
      inventory: sessionId ? (() => {
        const found = getInventory(sessionId)
        const merged = found ? withLivePromptState(found, sessionId) : null
        return merged ? { ...merged, sources: sourcesFor(merged) } : null
      })() : null,
      disabledSessionTools: sessionId ? getSessionDisabledTools(sessionId) : [],
      disabledSessionPrompts: sessionId ? getSessionDisabledPrompts(sessionId) : [],
      disabledTools: runtime.getDisabledTools(),
      promptTemplates,
      promptOverrides: runtime.getPromptOverrides(),
      extraPrompts: runtime.getExtraPrompts(),
      extraPromptPlacements: runtime.getExtraPromptPlacements(),
      applied: sessionId ? getAppliedTools(sessionId) : null,
    })
  }

  const inventoryToggleHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const kind = input?.kind
      const layer = input?.layer
      const name = input?.name
      const enabled = input?.enabled
      if (!['tool', 'prompt'].includes(kind) || !['session', 'global'].includes(layer) || typeof name !== 'string' || name.length === 0 || typeof enabled !== 'boolean') {
        return send(400, { ok: false, error: 'kind/layer/name/enabled are invalid' })
      }
      if (layer === 'global' && kind !== 'tool') return send(400, { ok: false, error: 'prompts only support the session layer' })
      if (layer === 'session') {
        const requestedSession = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
        const targetId = requestedSession || latestSessionId()
        if (!targetId) return send(409, { ok: false, error: 'no session yet' })
        if (kind === 'tool') setSessionToolEnabled(targetId, name, enabled)
        else setSessionPromptEnabled(targetId, name, enabled)
        saveSessionToggles()
        return send(202, { ok: true, layer, kind, name, enabled, note: 'applies to the next request' })
      }
      const found = findConfigEntry()
      if (!found) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
      const current = [...runtime.getDisabledTools()]
      const next = enabled ? current.filter((item) => item !== name) : current.includes(name) ? current : [...current, name]
      runtime.setDisabledTools(next)
      setGlobalDisabledTools(next)
      send(202, { ok: true, layer, kind, name, enabled, note: 'writes profile config; plugin reloads' })
      // 必须走同一个写队列：patch 是整段替换，并发 edit 会互相覆盖（丢 disabledTools 或 promptOverrides）。
      void queuePromptWrite(() => found.editor
        .edit(found.entry, (value) => ({ ...(value ?? {}), disabledTools: next })))
        .catch((error) => {
          log('warn', `inventory write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    })
  }

  const inventoryResetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const layer = input?.layer
      if (!['session', 'global', 'all'].includes(layer)) return send(400, { ok: false, error: 'layer must be session, global or all' })
      if (layer === 'session' || layer === 'all') {
        const requestedSession = typeof input?.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : null
        const targetId = requestedSession || latestSessionId()
        if (!targetId) return send(409, { ok: false, error: 'no session yet' })
        clearSessionToggles(targetId)
        saveSessionToggles()
      }
      if (layer === 'global' || layer === 'all') {
        const found = findConfigEntry()
        if (!found) return send(501, { ok: false, error: 'config editor unavailable in this profile' })
        runtime.setPromptOverrides({})
        runtime.setExtraPrompts({})
        runtime.setExtraPromptPlacements({})
        runtime.setDisabledTools([])
        setGlobalPromptOverrides({})
        setGlobalExtraPrompts({})
        setGlobalExtraPromptPlacements({})
        setGlobalDisabledTools([])
        send(202, { ok: true, layer })
        void queuePromptWrite(() => found.editor.edit(found.entry, (value) => ({
          ...(value ?? {}),
          disabledTools: [],
          promptOverrides: runtime.getPromptOverrides(),
          extraPrompts: runtime.getExtraPrompts(),
          extraPromptPlacements: runtime.getExtraPromptPlacements(),
        })))
          .catch(() => {})
        return
      }
      return send(202, { ok: true, layer })
    })
  }

  const promptEditHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      if (typeof input?.name !== 'string' || input.name.length === 0 || typeof input.text !== 'string') return send(400, { ok: false, error: 'name/text are required' })
      if (Buffer.byteLength(input.text, 'utf8') > MAX_PROMPT_TEXT_BYTES) {
        return send(400, { ok: false, error: `text is too large; limit is ${MAX_PROMPT_TEXT_BYTES} bytes` })
      }
      const next = { ...runtime.getPromptOverrides(), [input.name]: input.text }
      writePromptOverrides(next, response, send)
    })
  }

  const promptResetHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'POST')) return
    readJson(request, response, (input) => {
      const current = { ...runtime.getPromptOverrides() }
      const next = typeof input?.name === 'string' && input.name.length > 0 ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== input.name)) : {}
      writePromptOverrides(next, response, send)
    })
  }

  return {
    inventoryHandler,
    inventoryToggleHandler,
    inventoryResetHandler,
    promptEditHandler,
    promptResetHandler,
    withLivePromptState,
  }
}
