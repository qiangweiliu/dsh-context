/**
 * 跨会话分析（`/status/analytics`、`/status/insights` 的数据源）。
 *
 * 0.39.0 从 index.js 抽出：这段代码原本嵌在 `apply()` 里，既有纯函数（排序、区间、
 * 节省估算）又有带缓存的异步编排，导致「缓存命中/失效」这类行为只能靠真跑接口观察。
 * 现在纯函数直接导出、编排走 `createAnalytics(deps)` 注入，可用假依赖单测。
 *
 * 行为与抽取前一致：缓存键是 `(range, limit)`，TTL 5s，仅用于省掉同一范围内的重复
 * listSessions + 折叠。
 */
import { PRICING_CURRENCY, estimateInputCost } from './metrics.js'

/** 分析结果缓存 TTL：Overview 同时请求 /analytics 与 /insights 时会命中同一范围。 */
export const ANALYTICS_CACHE_TTL_MS = 5000

/** 缓存条目上限：键是 (range, limit)，正常使用只有个位数，超出说明有人在扫参数。 */
export const ANALYTICS_CACHE_MAX = 8

/** `?range=` 的白名单值；其余一律按 7d 处理（同时用于缓存键与导出文件名）。 */
export const RANGE_VALUES = ['today', '7d', '30d', 'all']

/**
 * 归一化 `?range=`：不在白名单里的一律回落 `7d`。
 * 这件事必须做——原始字符串既会进缓存键，也会进 `content-disposition` 的文件名。
 */
export function normalizeRange(value) {
  return RANGE_VALUES.includes(value) ? value : '7d'
}

/** `?range=` → 天数。未知值一律按 7 天。 */
export function parseRange(value) {
  if (value === 'today') return 1
  if (value === '30d') return 30
  if (value === 'all') return 3650
  return 7
}

/**
 * 会话的时间戳取值：优先最后活动时间，其次 updatedAt / createdAt；
 * 兼容 `record.header` 与 `record.session.header` 两种形状。
 */
export function sessionTimestamp(record) {
  const header = record?.header ?? record?.session?.header ?? record
  const value = header?.lastActivityAt ?? header?.updatedAt ?? header?.createdAt ?? record?.updatedAt ?? record?.createdAt
  return Number.isFinite(value) ? value : 0
}

/**
 * 会话列表排序：不依赖 provider 的数组顺序，显式按活动时间倒序。
 * DSH 的 sessionQuery header 只保证 createdAt，因此对旧会话这是近似值。
 */
export function sessionsNewestFirst(records) {
  if (!Array.isArray(records)) return []
  return records.slice().sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))
}

/** 压缩日志里 before→after 的差值，按 Flash 输入价折算成「单次上下文减少」的估算。 */
export function savingsFromLogs(logs, start, pricingRows) {
  const picked = (Array.isArray(logs) ? logs : []).filter((entry) => {
    if (!entry || entry.outcome !== 'success') return false
    const at = Date.parse(entry.at)
    return Number.isFinite(at) && at >= start
  })
  let tokens = 0
  for (const entry of picked) {
    const before = Number(entry.before)
    const after = Number(entry.after)
    if (Number.isFinite(before) && Number.isFinite(after) && before > after) tokens += before - after
  }
  const estimatedCost = estimateInputCost(tokens, 'deepseek-v4.1-flash', pricingRows)
  return {
    compactions: picked.length,
    tokens,
    estimatedCost,
    currency: PRICING_CURRENCY,
    method: 'compaction before-after at Flash input rate; one context reduction per event',
  }
}

/**
 * @param {{
 *   getSessionQuery: () => any,
 *   foldFor: (sessionId: string, header: any, ttlMs: number) => Promise<any>,
 *   summarizeFolds: (folds: any[], options: { days: number }) => any,
 *   readCompactionLog: () => any[],
 *   getPricing: () => any[],
 *   getLimit: () => number,
 *   readWithTimeout: (task: (signal: any) => Promise<any>, timeoutMs: number, label: string) => Promise<any>,
 *   mapLimit: (items: any[], concurrency: number, task: (item: any) => Promise<any>) => Promise<any[]>,
 * }} deps
 */
export function createAnalytics(deps) {
  const {
    getSessionQuery,
    foldFor,
    summarizeFolds,
    readCompactionLog,
    getPricing,
    getLimit,
    readWithTimeout,
    mapLimit,
  } = deps

  const cache = new Map()

  const payload = async (url) => {
    const query = getSessionQuery()
    if (!query || typeof query.listSessions !== 'function') {
      const error = new Error('sessionQuery unavailable in this host')
      error.statusCode = 503
      throw error
    }
    // range 先归一化再进缓存键：否则 `?range=任意串` 会生成无限个键（同时每次触发全量扫描）。
    const range = normalizeRange(url?.searchParams?.get('range') ?? null)
    const days = parseRange(range)
    const limit = Math.min(200, Math.max(1, Number(url?.searchParams?.get('limit')) || getLimit()))
    const cacheKey = `${range}\u0000${limit}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.at < ANALYTICS_CACHE_TTL_MS) return cached.payload

    const records = await readWithTimeout((signal) => query.listSessions(signal), 8000, 'listSessions')
    const list = sessionsNewestFirst(records)
    const picked = list.slice(0, limit)
    const warnings = []
    const folds = await mapLimit(picked, 4, async (record) => {
      try {
        return await foldFor(record.header.id, record.header, record.live ? 3000 : 20000)
      } catch (error) {
        warnings.push(`${record.header.id}: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })
    const summary = summarizeFolds(folds.filter(Boolean), { days })
    const result = {
      ok: true,
      generatedAt: new Date().toISOString(),
      // rangeKey 是归一化后的字符串，供导出文件名等场景使用；
      // 下面的 `...summary` 会把 `range` 覆盖成 {start, days} 区间对象（既有契约，保持不变）。
      rangeKey: range,
      range,
      coverage: { total: list.length, scanned: picked.length, withData: folds.filter(Boolean).length, limit },
      warnings: warnings.slice(0, 5),
      savings: savingsFromLogs(readCompactionLog(), summary.range.start, getPricing()),
      ...summary,
    }
    cache.set(cacheKey, { at: Date.now(), payload: result })
    // 上限保护：Map 的迭代顺序即插入顺序，删最早的一条即可（够用的 LRU 近似）。
    while (cache.size > ANALYTICS_CACHE_MAX) cache.delete(cache.keys().next().value)
    return result
  }

  return {
    payload,
    /** 测试与「写后立即读」场景使用：清掉短 TTL 缓存。 */
    clearCache: () => cache.clear(),
    cacheSize: () => cache.size,
  }
}
