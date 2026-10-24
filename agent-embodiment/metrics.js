/**
 * Pure session-log folding for the context insights UI.
 *
 * The host only reads session events through `ctx.sessionQuery` and hands the
 * raw arrays to these functions; nothing here touches Cordis, the filesystem or
 * the network. Keeping the math pure makes the aggregation testable without a
 * DSH runtime and keeps the HTTP layer thin.
 */

/** 官方人民币价（CNY / 1M tokens）。来源：DeepSeek 开放平台「模型 & 价格」。 */
export const PRICING_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
export const PRICING_CURRENCY = 'CNY'
export const PRICING_UPDATED_AT = '2026-10-24'

/**
 * 2026-10-24 抓取的官方价目：空闲价为高峰价的一半。
 * 高峰：北京时间周一至周五 09:00-12:00、14:00-18:00（法定节假日按官方规则为空闲，
 * 这里只按周末/时段判断，节假日差额见 LIMITATIONS）。
 */
export const PRICING_META = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    peak: { input: 2, cacheRead: 0.04, output: 8 },
    offPeak: { input: 1, cacheRead: 0.02, output: 4 },
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    peak: { input: 9, cacheRead: 0.3, output: 27 },
    offPeak: { input: 4.5, cacheRead: 0.15, output: 13.5 },
  },
]

export const DEFAULT_MODEL_PRICING = [
  { match: /deepseek[\s\-_/].*(flash|v4\.1)/i, peak: PRICING_META[0].peak, offPeak: PRICING_META[0].offPeak },
  { match: /deepseek[\s\-_/].*pro/i, peak: PRICING_META[1].peak, offPeak: PRICING_META[1].offPeak },
  // 旧模型名已不在当前官方价目表里；保留旧价只用于历史会话估算，不冒充 V4 价格。
  { match: /deepseek[\s\-_/].*(chat|v3)/i, input: 2, cacheRead: 0.5, output: 3 },
  { match: /deepseek[\s\-_/].*(reasoner|r1)/i, input: 4, cacheRead: 1, output: 8 },
]

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 官方高峰时段：北京时间周一至周五 09:00-12:00、14:00-18:00。 */
export function isPeakTime(time) {
  const stamp = Number(time)
  if (!Number.isFinite(stamp)) return false
  const local = new Date(stamp + BEIJING_OFFSET_MS)
  const day = local.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const usageOf = (usage) => {
  if (!usage || typeof usage !== 'object') return null
  const input = number(usage.inputTokens)
  const cacheRead = number(usage.cacheReadTokens)
  const cacheWrite = number(usage.cacheWriteTokens)
  const output = number(usage.outputTokens)
  const prompt = input + cacheRead + cacheWrite
  const total = number(usage.totalTokens) || prompt + output
  if (prompt === 0 && output === 0) return null
  return { input, cacheRead, cacheWrite, output, prompt, total }
}

const modelOf = (event, previous) => {
  const source = event?.data?.message?.source
  if (source && typeof source.model === 'string' && source.model !== '') {
    return { provider: typeof source.provider === 'string' ? source.provider : previous?.provider ?? null, model: source.model }
  }
  const header = event?.data?.header?.config
  if (header && typeof header.model === 'string' && header.model !== '') {
    return { provider: typeof header.provider === 'string' ? header.provider : previous?.provider ?? null, model: header.model }
  }
  return previous ?? null
}

const rateSet = (row) => ({
  input: number(row?.input),
  cacheRead: number(row?.cacheRead),
  cacheWrite: typeof row?.cacheWrite === 'number' ? row.cacheWrite : undefined,
  output: number(row?.output),
})

const normalizePricing = (pricing) => (Array.isArray(pricing) ? pricing : DEFAULT_MODEL_PRICING).map((row) => {
  const flat = rateSet(row)
  return {
    ...row,
    match: row.match instanceof RegExp ? row.match : new RegExp(row.match, 'i'),
    peak: row.peak ? rateSet(row.peak) : flat,
    offPeak: row.offPeak ? rateSet(row.offPeak) : flat,
  }
})

const priceOf = (model, pricing) => {
  if (typeof model !== 'string') return null
  const hit = pricing.find((row) => row.match.test(model))
  return hit ?? null
}

const costBreakdownOf = (model, usage, pricing, time) => {
  const price = priceOf(model, pricing)
  if (!price) return null
  const peak = isPeakTime(time)
  const rates = peak ? price.peak : price.offPeak
  const input = (usage.input / 1e6) * rates.input
  const cacheRead = (usage.cacheRead / 1e6) * rates.cacheRead
  const cacheWrite = (usage.cacheWrite / 1e6) * (rates.cacheWrite ?? rates.input)
  const output = (usage.output / 1e6) * rates.output
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output, peak, model }
}

const addCostParts = (target, parts) => {
  if (!parts) return
  target.input += parts.input
  target.cacheRead += parts.cacheRead
  target.cacheWrite += parts.cacheWrite
  target.output += parts.output
}

const dateKey = (time) => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const tokenTitle = (event) => {
  if (event?.type !== 'session/title') return null
  const title = event?.data?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : null
}

/**
 * Fold one session's raw event log into the aggregate shape used by the UI.
 * Unknown fields are omitted rather than guessed; callers can rely on null.
 *
 * @param {{id?: string, createdAt?: number, cwd?: string}} header
 * @param {readonly any[]} events
 */
export function foldSession(header, events, pricingRows = DEFAULT_MODEL_PRICING) {
  const pricing = normalizePricing(pricingRows)
  const list = Array.isArray(events) ? events.filter((event) => event && typeof event.time === 'number') : []
  const id = typeof header?.id === 'string' ? header.id : null
  const cwd = typeof header?.cwd === 'string' ? header.cwd : null
  const createdAt = typeof header?.createdAt === 'number' ? header.createdAt : list[0]?.time ?? null
  const base = {
    id,
    title: null,
    cwd,
    createdAt,
    lastActivityAt: list.length > 0 ? list[list.length - 1].time : createdAt,
    provider: null,
    model: null,
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, prompt: 0, total: 0 },
    requests: [],
    counts: { turns: 0, steps: 0, requests: 0, toolCalls: 0, compactions: 0, injections: 0 },
    activeMs: 0,
    cost: null,
    costParts: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    compactions: [],
    timeline: [],
    events: list.length,
  }
  if (list.length === 0) return base

  const turnStarts = new Map()
  const seenTurns = new Set()
  let model = null
  let title = null
  let activeMs = 0
  const requests = []
  const compactions = []
  const timeline = []
  let lastCompaction = null

  // 按本地日期聚合的账本：区间统计和图表都从这里取数，避免 KPI 用整段会话、
  // 图表只用区间请求而互相对不上。压缩摘要调用也记在这里。
  const daily = new Map()
  const bucketOf = (time) => {
    const date = dateKey(time)
    let bucket = daily.get(date)
    if (!bucket) {
      bucket = {
        date,
        tokens: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        cost: null,
        costParts: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        requests: 0,
        toolCalls: 0,
        compactions: 0,
        injections: 0,
        activeMs: 0,
      }
      daily.set(date, bucket)
    }
    return bucket
  }

  for (const event of list) {
    if (event.type === 'session/title') {
      const next = tokenTitle(event)
      if (next) title = next
      continue
    }
    if (event.type === 'request/header') {
      const next = modelOf(event, model)
      if (next && (!model || next.model !== model.model || next.provider !== model.provider)) model = next
      continue
    }
    if (event.type === 'turn/start') {
      const turn = event.data?.turn
      if (typeof turn === 'number') {
        turnStarts.set(`turn-${turn}`, event.time)
        seenTurns.add(turn)
      }
      continue
    }
    if (event.type === 'turn/end') {
      const turn = event.data?.turn
      const key = `turn-${turn}`
      if (turnStarts.has(key)) {
        const started = turnStarts.get(key)
        if (event.time > started) {
          const duration = event.time - started
          activeMs += duration
          bucketOf(event.time).activeMs += duration
        }
        turnStarts.delete(key)
      }
      continue
    }
    if (event.type === 'step/start') {
      base.counts.steps += 1
      continue
    }
    if (event.type === 'tool/call') {
      base.counts.toolCalls += 1
      bucketOf(event.time).toolCalls += 1
      continue
    }
    if (event.type === 'agent/inbox/spliced') {
      base.counts.injections += 1
      bucketOf(event.time).injections += 1
      timeline.push({ time: event.time, kind: 'inject', label: '注入', detail: '' })
      continue
    }
    if (event.type === 'compaction/start') {
      lastCompaction = { at: event.time, turn: event.data?.turn ?? null, startedAt: event.time, endedAt: null, shadowedTokens: null, durationMs: null, usage: null }
      continue
    }
    if (event.type === 'compaction/summary') {
      const shadowed = number(event.data?.shadowedTokenCount)
      const compaction = lastCompaction ?? { at: event.time, turn: event.data?.turn ?? null, startedAt: null, endedAt: null }
      compaction.endedAt = event.time
      compaction.shadowedTokens = shadowed || null
      const usage = usageOf(event.data?.usage)
      const compactionModel = typeof event.data?.model === 'string' && event.data.model !== '' ? event.data.model : model?.model ?? null
      const costParts = usage ? costBreakdownOf(compactionModel, usage, pricing, event.time) : null
      const cost = costParts ? costParts.total : null
      compaction.usage = usage
      compaction.model = compactionModel
      compaction.cost = cost
      compaction.costParts = costParts
      if (compaction.startedAt !== null) compaction.durationMs = event.time - compaction.startedAt
      lastCompaction = compaction
      base.counts.compactions += 1
      const bucket = bucketOf(event.time)
      bucket.compactions += 1
      // 压缩摘要也是一次模型调用；旧实现只把它存进 compaction.usage，没有进总账。
      if (usage) {
        base.usage.input += usage.input
        base.usage.cacheRead += usage.cacheRead
        base.usage.cacheWrite += usage.cacheWrite
        base.usage.output += usage.output
        base.usage.prompt += usage.prompt
        base.usage.total += usage.total
        bucket.tokens += usage.total
        bucket.input += usage.input
        bucket.cacheRead += usage.cacheRead
        bucket.cacheWrite += usage.cacheWrite
        bucket.output += usage.output
        if (cost !== null) {
          base.cost = (base.cost ?? 0) + cost
          bucket.cost = (bucket.cost ?? 0) + cost
          addCostParts(base.costParts, costParts)
          addCostParts(bucket.costParts, costParts)
        }
      }
      compactions.push(compaction)
      timeline.push({ time: compaction.endedAt, kind: 'compaction', label: '压缩', detail: shadowed > 0 ? `${shadowed} tokens` : '' })
      continue
    }
    if (event.type === 'compaction/end') {
      if (lastCompaction) {
        lastCompaction.endedAt = event.time
        if (lastCompaction.startedAt !== null) lastCompaction.durationMs = event.time - lastCompaction.startedAt
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const usage = usageOf(event.data?.usage)
      if (!usage) continue
      const requestModel = modelOf(event, model)
      if (requestModel) model = requestModel
      const costParts = costBreakdownOf(requestModel?.model, usage, pricing, event.time)
      const cost = costParts ? costParts.total : null
      const request = {
        time: event.time,
        turn: typeof event.data?.turn === 'number' ? event.data.turn : null,
        step: typeof event.data?.step === 'number' ? event.data.step : null,
        model: requestModel?.model ?? null,
        usage,
        cost,
        costParts,
      }
      requests.push(request)
      base.counts.requests += 1
      base.usage.input += usage.input
      base.usage.cacheRead += usage.cacheRead
      base.usage.cacheWrite += usage.cacheWrite
      base.usage.output += usage.output
      base.usage.prompt += usage.prompt
      base.usage.total += usage.total
      const bucket = bucketOf(event.time)
      bucket.tokens += usage.total
      bucket.input += usage.input
      bucket.cacheRead += usage.cacheRead
      bucket.cacheWrite += usage.cacheWrite
      bucket.output += usage.output
      bucket.requests += 1
      if (cost !== null) {
        base.cost = (base.cost ?? 0) + cost
        bucket.cost = (bucket.cost ?? 0) + cost
        addCostParts(base.costParts, costParts)
        addCostParts(bucket.costParts, costParts)
      }
      continue
    }
  }

  for (const started of turnStarts.values()) {
    const last = list[list.length - 1].time
    if (last > started) {
      const duration = last - started
      activeMs += duration
      bucketOf(last).activeMs += duration
    }
  }
  base.counts.turns = seenTurns.size
  base.activeMs = activeMs
  base.title = title ?? null
  base.provider = model?.provider ?? null
  base.model = model?.model ?? null
  base.requests = requests
  base.compactions = compactions
  base.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
  base.timeline = timeline.slice(-200)
  base.cacheHit = base.usage.input + base.usage.cacheRead > 0 ? base.usage.cacheRead / (base.usage.input + base.usage.cacheRead) : null
  return base
}

/**
 * Aggregate folded sessions into the dashboard payload. `fold` entries may be
 * partial when a session log could not be read; those are skipped.
 *
 * @param {readonly any[]} folds
 * @param {{now?: number, days?: number}} options
 */
export function summarizeFolds(folds, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const days = Number.isInteger(options.days) && options.days > 0 ? options.days : 7
  const start = now - days * 24 * 60 * 60 * 1000
  const sessions = folds
    .filter((fold) => fold && fold.id && (fold.lastActivityAt === null || fold.lastActivityAt >= start))
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
  const totals = {
    sessions: sessions.length,
    tokens: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    toolCalls: 0,
    compactions: 0,
    injections: 0,
    activeMs: 0,
    cost: null,
    costParts: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  }
  const daily = new Map()
  const bucketDays = Math.min(days, 90)
  for (let index = bucketDays - 1; index >= 0; index -= 1) {
    const time = now - index * 24 * 60 * 60 * 1000
    daily.set(dateKey(time), { date: dateKey(time), tokens: 0, output: 0, cost: null, requests: 0 })
  }
  // 按日粒度取数：KPI 与图表用同一批 bucket，避免“KPI 算整段会话、图表只算区间请求”。
  const startDate = dateKey(start)
  for (const fold of sessions) {
    const buckets = Array.isArray(fold.daily) ? fold.daily : null
    if (!buckets) {
      // 兼容没有 daily 的旧/部分 fold：退回整段会话口径。
      totals.tokens += fold.usage.total
      totals.input += fold.usage.input
      totals.cacheRead += fold.usage.cacheRead
      totals.cacheWrite += fold.usage.cacheWrite
      totals.output += fold.usage.output
      totals.toolCalls += fold.counts.toolCalls
      totals.compactions += fold.counts.compactions
      totals.injections += fold.counts.injections
      totals.activeMs += fold.activeMs
      if (fold.cost !== null) totals.cost = (totals.cost ?? 0) + fold.cost
      addCostParts(totals.costParts, fold.costParts)
      continue
    }
    for (const bucket of buckets) {
      if (!bucket || typeof bucket.date !== 'string' || bucket.date < startDate) continue
      totals.tokens += number(bucket.tokens)
      totals.input += number(bucket.input)
      totals.cacheRead += number(bucket.cacheRead)
      totals.cacheWrite += number(bucket.cacheWrite)
      totals.output += number(bucket.output)
      totals.toolCalls += number(bucket.toolCalls)
      totals.compactions += number(bucket.compactions)
      totals.injections += number(bucket.injections)
      totals.activeMs += number(bucket.activeMs)
      if (typeof bucket.cost === 'number') totals.cost = (totals.cost ?? 0) + bucket.cost
      addCostParts(totals.costParts, bucket.costParts)
      const chartBucket = daily.get(bucket.date)
      if (chartBucket) {
        chartBucket.tokens += number(bucket.tokens)
        chartBucket.output += number(bucket.output)
        chartBucket.requests += number(bucket.requests)
        if (typeof bucket.cost === 'number') chartBucket.cost = (chartBucket.cost ?? 0) + bucket.cost
      }
    }
  }
  const cacheBase = totals.input + totals.cacheRead
  return {
    range: { kind: `${days}d`, days, start, end: now },
    kpi: {
      sessions: totals.sessions,
      tokens: totals.tokens,
      input: totals.input,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      output: totals.output,
      cacheHit: cacheBase > 0 ? totals.cacheRead / cacheBase : null,
      toolCalls: totals.toolCalls,
      compactions: totals.compactions,
      injections: totals.injections,
      activeMs: totals.activeMs,
      cost: totals.cost,
      costParts: totals.costParts,
      currency: PRICING_CURRENCY,
    },
    daily: [...daily.values()],
    sessions: sessions.map((fold) => ({
      id: fold.id,
      title: fold.title,
      cwd: fold.cwd,
      createdAt: fold.createdAt,
      lastActivityAt: fold.lastActivityAt,
      provider: fold.provider,
      model: fold.model,
      tokens: fold.usage.total,
      cacheRead: fold.usage.cacheRead,
      cacheHit: fold.cacheHit,
      turns: fold.counts.turns,
      steps: fold.counts.steps,
      requests: fold.counts.requests,
      toolCalls: fold.counts.toolCalls,
      compactions: fold.counts.compactions,
      activeMs: fold.activeMs,
      cost: fold.cost,
      costParts: fold.costParts,
    })),
  }
}

/** Build the per-session trend payload (requests + compaction markers). */
export function sessionDetail(fold) {
  const compacted = fold.compactions
    .filter((compaction) => typeof compaction.endedAt === 'number')
    .sort((a, b) => a.endedAt - b.endedAt)
  // 请求按时间正序：每个请求带上"它之前最近一次已结束的压缩"。
  let marker = 0
  let latestCompaction = null
  const requests = fold.requests.map((request) => {
    while (marker < compacted.length && compacted[marker].endedAt <= request.time) {
      latestCompaction = compacted[marker]
      marker += 1
    }
    return {
      time: request.time,
      turn: request.turn,
      step: request.step,
      model: request.model,
      prompt: request.usage.prompt,
      output: request.usage.output,
      total: request.usage.total,
      cacheRead: request.usage.cacheRead,
      cost: request.cost,
      costParts: request.costParts,
      compaction: latestCompaction,
    }
  })
  return {
    session: {
      id: fold.id,
      title: fold.title,
      cwd: fold.cwd,
      model: fold.model,
      provider: fold.provider,
      createdAt: fold.createdAt,
      lastActivityAt: fold.lastActivityAt,
      cost: fold.cost,
      costParts: fold.costParts,
    },
    requests,
    compactions: compacted.map((item) => ({
      at: item.endedAt,
      startedAt: item.startedAt,
      durationMs: item.durationMs,
      shadowedTokens: item.shadowedTokens,
      turn: item.turn,
      cost: item.cost,
      costParts: item.costParts,
    })),
    timeline: fold.timeline,
  }
}
