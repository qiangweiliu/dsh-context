/**
 * routes-status.js 的直接单测（不需要 Cordis / app.asar）。
 *
 * 重点固定以前只能「起完整宿主再观察」的行为：状态缓存按 revision + TTL 失效、
 * `?fresh=1` 绕过缓存、live 的 404/比率、导出的 filename 与 CSV 列。
 *
 * 运行：node test/routes-status.mjs
 */
import { createStatusRoutes } from '../routes-status.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const jsonSender = (response) => (status, body) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}
const sendJson = (response, status, body) => jsonSender(response)(status, body)
const requireMethod = (request, response, method) => {
  if (request.method === method) return true
  jsonSender(response)(405, { ok: false, error: 'method not allowed' })
  return false
}
const requestUrl = (request) => new URL(`http://127.0.0.1${request.url ?? '/'}`)
const sessionsNewestFirst = (records) => (Array.isArray(records) ? records.slice() : [])
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}
const csvDocument = (lines) => `\uFEFF${lines.join('\r\n')}\r\n`

/** 假 runtime：只实现本模块用到的方法。 */
const makeRuntime = (options = {}) => {
  let cache = { at: 0, revision: -1, text: '' }
  let revision = options.revision ?? 1
  const writes = []
  return {
    runtime: {
      paths: { profileName: 'web' },
      getConfigEditor: () => (options.noEditor ? null : { edit: async () => {} }),
      getOnboarding: () => ({ completed: true, budgetConfirmed: true }),
      readStatusCache: () => cache,
      writeStatusCache: (entry) => { cache = entry; writes.push(entry) },
      getStatusRevision: () => revision,
      getSessions: () => options.sessions ?? null,
    },
    writes,
    bumpRevision: () => { revision += 1 },
    seedCache: (text) => { cache = { at: Date.now(), revision, text } },
  }
}

const measures = { calls: 0, throwOn: false }
const makeRoutes = (options = {}) => {
  const handle = makeRuntime(options.runtime ?? {})
  let snapshots = 0
  const routes = createStatusRoutes({
    runtime: handle.runtime,
    getConfig: () => ({
      contextWindowTokens: 128000,
      warnAt: 0.7,
      errorAt: 0.9,
      triggerAt: 0.85,
      targetAt: 0.6,
      keepTokens: 0.25,
      compressionStrategy: 'balanced',
      analyticsLimit: 40,
      modelPricing: [{ match: 'custom', input: 1 }],
      ...(options.config || {}),
    }),
    getMeasurements: () => new Map([['s1', { totalTokens: 64000, at: '2026-11-15T00:00:00.000Z' }]]),
    controlSnapshot: () => { snapshots += 1; return { active: true, mode: 'idle', presetMountable: false } },
    getCompacting: () => false,
    measure: () => {
      measures.calls += 1
      if (measures.throwOn) throw new Error('meter down')
      return { totalTokens: 64000 }
    },
    budgetFor: () => 128000,
    breakdownOf: () => undefined,
    requestUrl,
    jsonSender,
    sendJson,
    requireMethod,
    sessionsNewestFirst,
    analyticsPayload: async (url) => {
      if (options.analyticsThrows) {
        const error = new Error('sessionQuery unavailable in this host')
        error.statusCode = 503
        throw error
      }
      const format = url.searchParams.get('format')
      return { ok: true, range: '7d', sessions: [{ id: 'a', title: '=cmd', cwd: '/tmp/x', tokens: 10, cost: 1 }], format }
    },
    buildHealth: () => ({ healthy: true, checks: [{ id: 'control', ok: true }] }),
    holidayInfo: () => ({ builtin: 31, custom: [], total: 31, builtinYears: ['2026'], years: ['2026'] }),
    beijingYear: () => 2026,
    isPeakTime: () => true,
    listSessionBudgets: () => [{ sessionId: 's1', tokens: 32000 }],
    getControlBudget: () => 0,
    csvCell,
    csvDocument,
    statusCacheMs: options.statusCacheMs ?? 800,
    constants: {
      version: '0.40.0',
      compatibility: { profiles: ['web', 'desktop'] },
      pricingCurrency: 'CNY',
      pricingSource: 'https://example.invalid/pricing',
      pricingUpdatedAt: '2026-10-24',
      pricingMeta: [{ id: 'flash' }],
    },
  })
  return { routes, handle, snapshots: () => snapshots }
}

const makeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
  end(body) { this.body = body ?? '' },
})
const call = (handler, url) => {
  const response = makeResponse()
  handler({ method: 'GET', url: url ?? '/' }, response)
  return response
}

// ── status：结构 ──
const first = makeRoutes()
const status = call(first.routes.statusHandler, '/')
const statusBody = JSON.parse(status.body)
check('status 返回 200 + no-store', status.statusCode === 200 && status.headers['cache-control'] === 'no-store', status.statusCode)
check('payload 带 plugin/version/profile', statusBody.plugin === 'agent-embodiment' && statusBody.version === '0.40.0' && statusBody.profile === 'web', statusBody.plugin)
check('budget 来源为 default（控制行未设）', statusBody.budget.source === 'default' && statusBody.budget.controlTokens === 0, statusBody.budget)
check('onboarding 预算取 config.contextWindowTokens', statusBody.onboarding.budgetTokens === 128000, statusBody.onboarding.budgetTokens)
check('带 health 与 pricing.holidays', statusBody.health.healthy === true && statusBody.pricing.holidays.total === 31, statusBody.pricing.holidays)
check('configEditable 反映 editor 存在', statusBody.configEditable === true)
check('sessionBudgets 透出', statusBody.sessionBudgets[0].sessionId === 's1', statusBody.sessionBudgets)

// ── status：缓存 ──
check('首次调用后写入缓存', first.handle.writes.length === 1, first.handle.writes.length)
const snapshotsAfterFirst = first.snapshots()
const second = call(first.routes.statusHandler, '/')
check('revision 未变且 TTL 内命中缓存', first.snapshots() === snapshotsAfterFirst && second.body === status.body, first.snapshots())
const fresh = call(first.routes.statusHandler, '/?fresh=1')
check('?fresh=1 绕过缓存', first.snapshots() === snapshotsAfterFirst + 1 && first.handle.writes.length === 2 && fresh.body.length > 0, first.snapshots())
first.handle.bumpRevision()
call(first.routes.statusHandler, '/')
check('revision 变化后失效', first.snapshots() === snapshotsAfterFirst + 2, first.snapshots())

const noCache = makeRoutes({ statusCacheMs: 0 })
call(noCache.routes.statusHandler, '/')
call(noCache.routes.statusHandler, '/')
check('TTL=0 时每次都重建', noCache.snapshots() === 2, noCache.snapshots())

const seeded = makeRoutes()
seeded.handle.seedCache('{"seeded":true}')
check('已有缓存时直接返回（不再构建）', call(seeded.routes.statusHandler, '/').body === '{"seeded":true}' && seeded.snapshots() === 0, seeded.snapshots())

// ── live ──
const session = { id: 'sess-1' }
const live = makeRoutes({ runtime: { sessions: { get: (id) => (id === 'sess-1' ? session : undefined), list: () => [session] } } })
const liveBody = JSON.parse(call(live.routes.liveHandler, '/').body)
check('live 返回 200 并带 used/budget/ratio', liveBody.ok === true && liveBody.used === 64000 && liveBody.budget === 128000 && liveBody.ratio === 0.5, liveBody)
check('live 带 compacting 与阈值字段', liveBody.compacting === false && liveBody.warnAt === 0.7, liveBody)
const unknown = call(live.routes.liveHandler, '/?sessionId=nope')
check('live 未知 session 返回 404', unknown.statusCode === 404 || JSON.parse(unknown.body).ok === false, unknown.statusCode)
const empty = makeRoutes({ runtime: { sessions: { list: () => [] } } })
check('live 无会话返回 404', call(empty.routes.liveHandler, '/').statusCode === 404)

measures.throwOn = true
const degraded = makeRoutes({ runtime: { sessions: { get: (id) => (id === 'sess-1' ? session : undefined), list: () => [session] } } })
const degradedBody = JSON.parse(call(degraded.routes.liveHandler, '/').body)
check('tokenMeter 抛错时 used 为 null 而不是 500', degradedBody.ok === true && degradedBody.used === null, degradedBody)
measures.throwOn = false

// ── export ──
const exportRoutes = makeRoutes()

const jsonResponse = makeResponse()
await exportRoutes.routes.exportHandler({ method: 'GET', url: '/' }, jsonResponse)
check('export JSON 设置附件名', jsonResponse.statusCode === 200 && String(jsonResponse.headers['content-disposition']).includes('agent-embodiment-7d.json'), jsonResponse.headers['content-disposition'])

const csvResponse = makeResponse()
await exportRoutes.routes.exportHandler({ method: 'GET', url: '/?format=csv' }, csvResponse)
check('export CSV 类型与 BOM', String(csvResponse.headers['content-type']).startsWith('text/csv') && csvResponse.body.startsWith('\uFEFF'), csvResponse.body.slice(0, 12))
check('CSV 表头列顺序固定', csvResponse.body.replace(/^\uFEFF/u, '').split('\r\n')[0].startsWith('id,title,cwd,model,tokens'), csvResponse.body.slice(1, 40))
check('CSV 中和公式注入', csvResponse.body.includes("'=cmd"), csvResponse.body.split('\r\n')[1])

const failing = makeRoutes({ analyticsThrows: true })
const failedResponse = makeResponse()
await failing.routes.exportHandler({ method: 'GET', url: '/' }, failedResponse)
check('export 透出 analytics 的 503', failedResponse.statusCode === 503 && /sessionQuery unavailable/u.test(failedResponse.body), failedResponse.body)

const postExport = makeResponse()
await exportRoutes.routes.exportHandler({ method: 'POST', url: '/' }, postExport)
check('export 拒绝 POST（405）', postExport.statusCode === 405, postExport.statusCode)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[routes-status] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
