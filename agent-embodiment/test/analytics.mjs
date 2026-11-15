/**
 * analytics.js 的直接单测（不需要 Cordis / app.asar）。
 *
 * 重点固定两类容易回退的行为：
 * 1) 纯函数语义——排序优先级（lastActivityAt > updatedAt > createdAt）与区间解析；
 * 2) 编排语义——(range,limit) 短 TTL 缓存命中/失效、limit 夹取、失败折叠只留 5 条告警。
 *
 * 运行：node test/analytics.mjs
 */
import { createAnalytics, parseRange, savingsFromLogs, sessionTimestamp, sessionsNewestFirst } from '../analytics.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

// ── parseRange ──
check('parseRange today=1', parseRange('today') === 1, parseRange('today'))
check('parseRange 30d=30', parseRange('30d') === 30)
check('parseRange all=3650', parseRange('all') === 3650)
check('parseRange 未知值回落到 7', parseRange('nope') === 7 && parseRange(undefined) === 7)

// ── sessionTimestamp 优先级 ──
check('lastActivityAt 优先于 createdAt', sessionTimestamp({ header: { lastActivityAt: 500, createdAt: 100 } }) === 500)
check('缺 lastActivityAt 时用 updatedAt', sessionTimestamp({ header: { updatedAt: 400, createdAt: 100 } }) === 400)
check('兼容 record.session.header 形状', sessionTimestamp({ session: { header: { createdAt: 300 } } }) === 300)
check('非有限值返回 0', sessionTimestamp({ header: { createdAt: 'yesterday' } }) === 0 && sessionTimestamp(null) === 0)

// ── sessionsNewestFirst ──
const records = [
  { header: { id: 'a', lastActivityAt: 100 } },
  { header: { id: 'b', lastActivityAt: 300 } },
  { header: { id: 'c', lastActivityAt: 200 } },
]
check('按活动时间倒序', sessionsNewestFirst(records).map((item) => item.header.id).join('') === 'bca', sessionsNewestFirst(records).map((item) => item.header.id))
check('不修改入参数组', records[0].header.id === 'a' && sessionsNewestFirst(records) !== records)
check('非数组返回空数组', sessionsNewestFirst(null).length === 0)

// ── savingsFromLogs ──
const pricing = [{ match: 'flash', input: 2, cacheRead: 0.04, output: 8 }]
const logs = [
  { outcome: 'success', at: '2026-11-15T00:00:00.000Z', before: 1000, after: 400 },
  { outcome: 'success', at: '2026-11-15T00:00:00.000Z', before: 900, after: 900 },
  { outcome: 'failure', at: '2026-11-15T00:00:00.000Z', before: 5000, after: 100 },
  { outcome: 'success', at: '2026-01-01T00:00:00.000Z', before: 5000, after: 100 },
]
const savings = savingsFromLogs(logs, Date.parse('2026-11-01T00:00:00.000Z'), pricing)
check('只统计区间内成功的压缩', savings.compactions === 2, savings.compactions)
check('只累加 before>after 的差值', savings.tokens === 600, savings.tokens)
check('节省带币种与口径说明', savings.currency === 'CNY' && typeof savings.method === 'string', savings)

// ── createAnalytics 编排 ──
const makeHarness = (options = {}) => {
  const calls = { listSessions: 0, folds: [], timeouts: [], limits: [] }
  const list = options.list ?? [
    { header: { id: 's1', lastActivityAt: 300 }, live: false },
    { header: { id: 's2', lastActivityAt: 200 }, live: true },
  ]
  const analytics = createAnalytics({
    getSessionQuery: () => (options.noQuery ? null : { listSessions: async () => list }),
    foldFor: async (sessionId, header, ttlMs) => {
      calls.folds.push([sessionId, ttlMs])
      if (options.failIds?.includes(sessionId)) throw new Error('fold failed')
      return { id: sessionId, usage: { total: 100 }, counts: {}, usageOk: true }
    },
    summarizeFolds: (folds, { days }) => ({ sessions: folds.length, range: { start: Date.parse('2026-11-01T00:00:00.000Z'), days }, totals: { tokens: folds.length * 100 } }),
    readCompactionLog: () => logs,
    getPricing: () => pricing,
    getLimit: () => { calls.limits.push(1); return 40 },
    readWithTimeout: async (task) => { calls.timeouts.push(1); return task() },
    mapLimit: async (items, _concurrency, task) => Promise.all(items.map((item) => task(item))),
  })
  return { analytics, calls }
}

const url = (query) => new URL(`http://127.0.0.1/api/agent-embodiment/status/analytics${query}`)

const { analytics, calls } = makeHarness()
const first = await analytics.payload(url('?range=7d'))
check('payload 带 ok/coverage', first.ok === true && first.coverage.total === 2 && first.coverage.scanned === 2 && first.coverage.limit === 40, first.coverage)
check('payload.range 是 summarizeFolds 的区间对象（与线上一致）', typeof first.range === 'object' && first.range.days === 7, first.range)
check('payload 汇总来自 summarizeFolds', first.sessions === 2 && first.range.days === 7, first)
check('payload 的 savings 按 summary.range.start 过滤', first.savings && first.savings.compactions === 2 && first.savings.tokens === 600, first.savings)
check('live 会话用短 TTL、非 live 用长 TTL', JSON.stringify(calls.folds) === JSON.stringify([['s1', 20000], ['s2', 3000]]), calls.folds)

const second = await analytics.payload(url('?range=7d'))
check('同 range+limit 命中缓存（不再 listSessions）', calls.timeouts.length === 1 && second === first, { timeouts: calls.timeouts.length })
await analytics.payload(url('?range=7d&limit=5'))
check('不同 limit 视为不同缓存键', calls.timeouts.length === 2, calls.timeouts.length)
analytics.clearCache()
await analytics.payload(url('?range=7d'))
check('clearCache 后重新拉取', calls.timeouts.length === 3, calls.timeouts.length)

const clamped = makeHarness()
await clamped.analytics.payload(url('?limit=9999'))
check('limit 上限夹到 200', clamped.analytics.cacheSize() === 1 && clamped.calls.timeouts.length === 1)
const zeroLimit = makeHarness()
await zeroLimit.analytics.payload(url('?limit=0'))
check('limit=0 时回落到配置值', zeroLimit.calls.limits.length === 1)

const failing = makeHarness({ failIds: ['s1', 's2'] })
const failedPayload = await failing.analytics.payload(url('?range=all'))
check('折叠失败只留告警、不留 null 数据', failedPayload.coverage.withData === 0 && failedPayload.warnings.length === 2, failedPayload.warnings)
check('告警最多 5 条', (await makeHarness({ list: Array.from({ length: 8 }, (_, i) => ({ header: { id: `x${i}`, lastActivityAt: i } })), failIds: ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'] }).analytics.payload(url(''))).warnings.length === 5)

const noQuery = createAnalytics({
  getSessionQuery: () => null,
  foldFor: async () => null,
  summarizeFolds: () => ({}),
  readCompactionLog: () => [],
  getPricing: () => [],
  getLimit: () => 40,
  readWithTimeout: async (task) => task(),
  mapLimit: async (items, _c, task) => Promise.all(items.map((item) => task(item))),
})
let thrown = null
try { await noQuery.payload(url('')) } catch (error) { thrown = error }
check('没有 sessionQuery 时抛 503', thrown?.statusCode === 503 && /sessionQuery unavailable/u.test(thrown.message), thrown?.message)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[analytics] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
