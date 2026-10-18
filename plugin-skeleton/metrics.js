/**
 * Pure session-log folding for the context insights UI.
 *
 * The host only reads session events through `ctx.sessionQuery` and hands the
 * raw arrays to these functions; nothing here touches Cordis, the filesystem or
 * the network. Keeping the math pure makes the aggregation testable without a
 * DSH runtime and keeps the HTTP layer thin.
 */

/** CNY per 1M tokens, used only for models we can name confidently. */
export const MODEL_PRICING = [
  { match: /deepseek[-_/].*(reasoner|r1)/i, input: 4, cacheRead: 1, output: 8 },
  { match: /deepseek[-_/].*(chat|v3)/i, input: 2, cacheRead: 0.5, output: 3 },
]

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const textOf = (content) => {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

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

const priceOf = (model) => {
  if (typeof model !== 'string') return null
  const hit = MODEL_PRICING.find((row) => row.match.test(model))
  return hit ?? null
}

const costOf = (model, usage) => {
  const price = priceOf(model)
  if (!price) return null
  return (
    (usage.input / 1e6) * price.input +
    (usage.cacheRead / 1e6) * price.cacheRead +
    (usage.cacheWrite / 1e6) * price.input +
    (usage.output / 1e6) * price.output
  )
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
export function foldSession(header, events) {
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
    costCurrency: 'CNY',
    costEstimated: true,
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
        if (event.time > started) activeMs += event.time - started
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
      continue
    }
    if (event.type === 'agent/inbox/spliced') {
      base.counts.injections += 1
      timeline.push({ time: event.time, kind: 'inject', label: '注入', detail: '' })
      continue
    }
    if (event.type === 'compaction/start') {
      lastCompaction = { at: event.time, turn: event.data?.turn ?? null, startedAt: event.time, endedAt: null, shadowedTokens: null, durationMs: null, summaryTokens: null, usage: null }
      continue
    }
    if (event.type === 'compaction/summary') {
      const shadowed = number(event.data?.shadowedTokenCount)
      const compaction = lastCompaction ?? { at: event.time, turn: event.data?.turn ?? null, startedAt: null, endedAt: null }
      compaction.endedAt = event.time
      compaction.shadowedTokens = shadowed || null
      compaction.summaryTokens = Array.isArray(event.data?.summary) ? textOf(event.data.summary).length : null
      compaction.usage = usageOf(event.data?.usage)
      if (compaction.startedAt !== null) compaction.durationMs = event.time - compaction.startedAt
      lastCompaction = compaction
      base.counts.compactions += 1
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
      const cost = costOf(requestModel?.model, usage)
      const request = {
        time: event.time,
        turn: typeof event.data?.turn === 'number' ? event.data.turn : null,
        step: typeof event.data?.step === 'number' ? event.data.step : null,
        model: requestModel?.model ?? null,
        usage,
        cost,
      }
      requests.push(request)
      base.counts.requests += 1
      base.usage.input += usage.input
      base.usage.cacheRead += usage.cacheRead
      base.usage.cacheWrite += usage.cacheWrite
      base.usage.output += usage.output
      base.usage.prompt += usage.prompt
      base.usage.total += usage.total
      if (cost !== null) base.cost = (base.cost ?? 0) + cost
      continue
    }
  }

  for (const started of turnStarts.values()) {
    const last = list[list.length - 1].time
    if (last > started) activeMs += last - started
  }
  base.counts.turns = seenTurns.size
  base.activeMs = activeMs
  base.title = title ?? null
  base.provider = model?.provider ?? null
  base.model = model?.model ?? null
  base.requests = requests
  base.compactions = compactions
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
    output: 0,
    toolCalls: 0,
    compactions: 0,
    injections: 0,
    activeMs: 0,
    cost: null,
    costSessions: 0,
    costKnownRequests: 0,
    costUnknownRequests: 0,
  }
  const daily = new Map()
  const bucketDays = Math.min(days, 90)
  for (let index = bucketDays - 1; index >= 0; index -= 1) {
    const time = now - index * 24 * 60 * 60 * 1000
    daily.set(dateKey(time), { date: dateKey(time), tokens: 0, output: 0, cost: null, requests: 0 })
  }
  for (const fold of sessions) {
    totals.tokens += fold.usage.total
    totals.input += fold.usage.input
    totals.cacheRead += fold.usage.cacheRead
    totals.output += fold.usage.output
    totals.toolCalls += fold.counts.toolCalls
    totals.compactions += fold.counts.compactions
    totals.injections += fold.counts.injections
    totals.activeMs += fold.activeMs
    if (fold.cost !== null) {
      totals.cost = (totals.cost ?? 0) + fold.cost
      totals.costSessions += 1
    }
    for (const request of fold.requests) {
      if (request.time < start) continue
      const bucket = daily.get(dateKey(request.time))
      if (!bucket) continue
      bucket.tokens += request.usage.total
      bucket.output += request.usage.output
      bucket.requests += 1
      if (request.cost !== null) bucket.cost = (bucket.cost ?? 0) + request.cost
    }
    for (const request of fold.requests) {
      if (request.cost !== null) totals.costKnownRequests += 1
      else totals.costUnknownRequests += 1
    }
  }
  const cacheBase = totals.input + totals.cacheRead
  return {
    range: { kind: `${days}d`, days, start, end: now },
    kpi: {
      sessions: totals.sessions,
      tokens: totals.tokens,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheHit: cacheBase > 0 ? totals.cacheRead / cacheBase : null,
      toolCalls: totals.toolCalls,
      compactions: totals.compactions,
      injections: totals.injections,
      activeMs: totals.activeMs,
      cost: totals.cost,
      costSessions: totals.costSessions,
      costKnownRequests: totals.costKnownRequests,
      costUnknownRequests: totals.costUnknownRequests,
      costCurrency: 'CNY',
      costEstimated: true,
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
      costCurrency: fold.costCurrency,
    })),
  }
}

/** Build the per-session trend payload (requests + compaction markers). */
export function sessionDetail(fold) {
  const compacted = fold.compactions.filter((compaction) => typeof compaction.endedAt === 'number')
  return {
    session: {
      id: fold.id,
      title: fold.title,
      cwd: fold.cwd,
      model: fold.model,
      provider: fold.provider,
      createdAt: fold.createdAt,
      lastActivityAt: fold.lastActivityAt,
    },
    requests: fold.requests.map((request) => ({
      time: request.time,
      turn: request.turn,
      step: request.step,
      model: request.model,
      prompt: request.usage.prompt,
      output: request.usage.output,
      total: request.usage.total,
      cacheRead: request.usage.cacheRead,
      cost: request.cost,
      compaction: compacted.find((item) => item.endedAt !== null && item.endedAt <= request.time && item.endedAt > request.time - 1) ?? null,
    })),
    compactions: compacted.map((item) => ({
      at: item.endedAt,
      startedAt: item.startedAt,
      durationMs: item.durationMs,
      shadowedTokens: item.shadowedTokens,
      summaryTokens: item.summaryTokens,
      turn: item.turn,
    })),
    timeline: fold.timeline,
  }
}

export const __testing = { dateKey, usageOf, costOf }
