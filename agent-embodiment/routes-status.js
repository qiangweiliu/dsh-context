/**
 * 状态读取三条路由：`/status`、`/status/live`、`/status/export`。
 *
 * 0.40.0 从 index.js 的 `apply()` 抽出（P1.4 最后一块）。它们的依赖此前只能通过闭包拿到，
 * 所以「状态缓存按 revision 失效」「live 无会话 404」这类行为只能起完整宿主再观察；
 * 现在依赖全部显式注入，可用假 runtime / 假 tokenMeter 直接单测。
 *
 * 行为与抽取前逐字一致：缓存条件（无 fresh、revision 一致、未过 TTL）、
 * 响应头（no-store / 导出 filename）、CSV 列顺序与公式注入中和都没变。
 */

/**
 * @param {{
 *   runtime: any,
 *   getConfig: () => any,
 *   getMeasurements: () => Map<string, any>,
 *   controlSnapshot: () => any,
 *   getCompacting: () => boolean,
 *   measure: (session: any) => any,
 *   budgetFor: (sessionId: string, fallback: number) => number,
 *   breakdownOf: (session: any, measurement: any) => any,
 *   requestUrl: (request: any) => URL,
 *   jsonSender: (response: any) => (status: number, body: any) => void,
 *   sendJson: (response: any, status: number, body: any) => void,
 *   requireMethod: (request: any, response: any, method: string) => boolean,
 *   sessionsNewestFirst: (records: any[]) => any[],
 *   analyticsPayload: (url: URL) => Promise<any>,
 *   buildHealth: (input: any) => any,
 *   holidayInfo: () => any,
 *   beijingYear: (time: number) => number,
 *   isPeakTime: (time: number) => boolean,
 *   listSessionBudgets: () => any[],
 *   getControlBudget: () => number,
 *   csvCell: (value: any) => string,
 *   csvDocument: (lines: string[]) => string,
 *   statusCacheMs: number,
 *   constants: { version: string, compatibility: any, pricingCurrency: string, pricingSource: string, pricingUpdatedAt: string, pricingMeta: any },
 * }} deps
 */
export function createStatusRoutes(deps) {
  const {
    runtime,
    getConfig,
    getMeasurements,
    controlSnapshot,
    getCompacting,
    measure,
    budgetFor,
    breakdownOf,
    requestUrl,
    jsonSender,
    sendJson,
    requireMethod,
    sessionsNewestFirst,
    analyticsPayload,
    buildHealth,
    holidayInfo,
    beijingYear,
    isPeakTime,
    listSessionBudgets,
    getControlBudget,
    csvCell,
    csvDocument,
    statusCacheMs,
    constants,
  } = deps

  const configEditable = () => {
    const editor = runtime.getConfigEditor()
    return Boolean(editor && typeof editor.edit === 'function')
  }
  const onboardingPayload = () => ({ ...(runtime.getOnboarding() || {}), budgetTokens: getConfig().contextWindowTokens })

  const statusHandler = (request, response) => {
    if (!requireMethod(request, response, 'GET')) return
    const sendCached = (text) => {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(text)
    }
    const url = requestUrl(request)
    const cached = runtime.readStatusCache()
    if (
      url.searchParams.get('fresh') !== '1'
      && cached.text
      && cached.revision === runtime.getStatusRevision()
      && Date.now() - cached.at < statusCacheMs
    ) {
      return sendCached(cached.text)
    }
    const config = getConfig()
    const measurements = getMeasurements()
    const latestMeasurement = [...measurements.values()].reverse()[0] ?? null
    const onboarding = onboardingPayload()
    const control = controlSnapshot()
    const holidayState = holidayInfo()
    const health = buildHealth({
      control,
      configEditable: configEditable(),
      onboarding,
      latest: latestMeasurement,
      version: constants.version,
      holidays: holidayState,
      year: beijingYear(Date.now()),
    })
    const body = JSON.stringify({
      plugin: 'agent-embodiment',
      version: constants.version,
      profile: runtime.paths.profileName ?? null,
      compatibility: constants.compatibility,
      budget: {
        tokens: config.contextWindowTokens,
        warnAt: config.warnAt,
        errorAt: config.errorAt,
        triggerAt: config.triggerAt,
        targetAt: config.targetAt,
        keepTokens: config.keepTokens,
        compressionStrategy: config.compressionStrategy,
        analyticsLimit: config.analyticsLimit,
        // 生效来源：控制行 >0 时它优先于宿主默认值（见 state.budgetFor）。
        source: getControlBudget() > 0 ? 'control' : 'default',
        controlTokens: getControlBudget(),
      },
      sessionBudgets: listSessionBudgets(),
      control,
      health,
      onboarding,
      configEditable: configEditable(),
      measurements: [...measurements.values()].reverse(),
      pricing: {
        currency: constants.pricingCurrency,
        source: constants.pricingSource,
        updatedAt: constants.pricingUpdatedAt,
        peakNow: isPeakTime(Date.now()),
        peakHours: '周一至周五 09:00–12:00、14:00–18:00（北京时间）',
        models: constants.pricingMeta,
        custom: Array.isArray(config.modelPricing) && config.modelPricing.length > 0,
        rows: Array.isArray(config.modelPricing) ? config.modelPricing : [],
        // 节假日：内置表 + 配置补充；面板只读展示，避免每年改代码发版。
        holidays: holidayInfo(),
      },
    })
    runtime.writeStatusCache({ at: Date.now(), revision: runtime.getStatusRevision(), text: body })
    sendCached(body)
  }

  /** GET 实时占用：按 sessionId 找到 Session，用 tokenMeter 现场测量。 */
  const liveHandler = (request, response) => {
    const send = jsonSender(response)
    if (!requireMethod(request, response, 'GET')) return
    const config = getConfig()
    const requested = requestUrl(request).searchParams.get('sessionId') ?? ''
    let sessionId = requested
    let session
    const sessions = runtime.getSessions()
    if (sessions && typeof sessions.get === 'function') {
      if (requested) {
        session = sessions.get(requested)
      } else if (typeof sessions.list === 'function') {
        const all = sessionsNewestFirst(sessions.list())
        const latest = all[0]
        if (latest) {
          session = latest
          sessionId = latest.id
        }
      }
    }
    if (!session) return send(404, { ok: false, error: requested ? 'unknown session' : 'no session yet' })
    let used = null
    let measurement
    try {
      measurement = measure(session)
      used = typeof measurement?.totalTokens === 'number' ? measurement.totalTokens : null
    } catch {
      measurement = undefined
    }
    const budget = budgetFor(sessionId, config.contextWindowTokens)
    return send(200, {
      ok: true,
      sessionId,
      used,
      budget,
      compacting: getCompacting(),
      breakdown: breakdownOf(session, measurement),
      warnAt: config.warnAt,
      errorAt: config.errorAt,
      triggerAt: config.triggerAt,
      targetAt: config.targetAt,
      keepTokens: config.keepTokens,
      compressionStrategy: config.compressionStrategy,
      ratio: typeof used === 'number' && budget > 0 ? used / budget : null,
    })
  }

  /** GET /status/export?format=json|csv：导出当前扫描范围的分析结果。 */
  const exportHandler = async (request, response) => {
    if (!requireMethod(request, response, 'GET')) return
    try {
      const url = requestUrl(request)
      const payload = await analyticsPayload(url)
      // 文件名只用归一化后的 rangeKey：payload.range 是区间对象（既可能变成 [object Object]，
      // 也不该让请求里的任意字符串进文件名）。
      const rangeLabel = typeof payload.rangeKey === 'string' && /^[a-z0-9]+$/u.test(payload.rangeKey)
        ? payload.rangeKey
        : (typeof payload.range === 'string' && /^[a-z0-9]+$/u.test(payload.range) ? payload.range : '7d')
      const format = (url.searchParams.get('format') || 'json').toLowerCase()
      if (format === 'csv') {
        const columns = ['id', 'title', 'cwd', 'model', 'tokens', 'input', 'cacheRead', 'cacheWrite', 'output', 'requests', 'toolCalls', 'compactions', 'activeMs', 'cost', 'lastActivityAt']
        const lines = [columns.join(',')]
        for (const session of payload.sessions) lines.push(columns.map((column) => csvCell(session[column])).join(','))
        response.statusCode = 200
        response.setHeader('content-type', 'text/csv; charset=utf-8')
        response.setHeader('content-disposition', `attachment; filename="agent-embodiment-${rangeLabel}.csv"`)
        response.setHeader('cache-control', 'no-store')
        response.end(csvDocument(lines))
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('content-disposition', `attachment; filename="agent-embodiment-${rangeLabel}.json"`)
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(payload, null, 2))
    } catch (error) {
      sendJson(response, error?.statusCode || 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { statusHandler, liveHandler, exportHandler }
}
