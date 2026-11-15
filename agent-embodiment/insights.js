/**
 * insights.js — 纯函数的产品洞察与健康检查。
 *
 * 为什么单独一层：面板需要的是「可执行结论」，不是更多图表；但结论必须能
 * 追溯到具体数字，且不依赖 Cordis / 文件系统。这里只接收已经折叠好的数据，
 * 输出稳定的 id + values，具体中英文文案由 client.js 负责。
 */

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const positive = (value) => number(value) > 0
const array = (value) => (Array.isArray(value) ? value : [])

/** 价格表超过这么多天没更新就提示（口径来自 metrics.PRICING_UPDATED_AT 的手工日期）。 */
export const PRICING_STALE_DAYS = 30

const sumBy = (items, read) => items.reduce((total, item) => total + number(read(item)), 0)

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const modelList = (sessions) => {
  const names = new Set()
  for (const session of sessions) if (typeof session.model === 'string' && session.model !== '') names.add(session.model)
  return [...names].slice(0, 4)
}

/**
 * 从跨会话统计、当前会话 inventory、压缩日志和首次运行状态生成洞察卡。
 *
 * 约定：只输出确定性的 id + values，不在这里拼中文/英文；同一 id 最多出现一次。
 * action 只描述 UI 应该去哪里，不直接执行副作用。
 *
 * @param {{
 *   analytics?: any,
 *   latest?: any,
 *   inventory?: any,
 *   toolUsage?: Record<string, number>,
 *   logs?: any[],
 *   pricing?: any,
 *   onboarding?: any,
 *   budget?: any,
 * }} input
 */
export function buildInsights(input = {}) {
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics : {}
  const sessions = array(analytics.sessions)
  const latest = input.latest && typeof input.latest === 'object' ? input.latest : null
  const inventory = input.inventory && typeof input.inventory === 'object' ? input.inventory : null
  const toolUsage = input.toolUsage && typeof input.toolUsage === 'object' ? input.toolUsage : analytics.toolUsage || {}
  const logs = array(input.logs)
  const pricing = input.pricing && typeof input.pricing === 'object' ? input.pricing : {}
  const onboarding = input.onboarding && typeof input.onboarding === 'object' ? input.onboarding : {}
  const budget = input.budget && typeof input.budget === 'object' ? input.budget : {}
  const results = []

  // 1) 当前会话里工具定义占比过高：最直接的 token 优化点。
  const breakdown = latest && latest.breakdown && typeof latest.breakdown === 'object' ? latest.breakdown : null
  const totalTokens = number(latest && latest.totalTokens)
  const toolsTokens = number(breakdown && breakdown.toolsTokens)
  if (totalTokens > 0 && toolsTokens / totalTokens >= 0.5) {
    results.push({
      id: 'tool-schema-share',
      severity: 'warn',
      values: {
        share: toolsTokens / totalTokens,
        toolsTokens,
        totalTokens,
      },
      action: { tab: 'settings', anchor: 'inventory' },
    })
  }

  // 2) 清单里的工具在已扫描会话中从未被调用：只提示，不自动禁用。
  const tools = array(inventory && inventory.tools)
  const unused = tools
    .filter((tool) => tool && typeof tool.name === 'string' && positive(tool.tokens) && number(toolUsage[tool.name]) === 0)
    .map((tool) => ({ name: tool.name, tokens: number(tool.tokens) }))
  if (unused.length >= 3) {
    results.push({
      id: 'unused-tools',
      severity: 'info',
      values: {
        count: unused.length,
        names: unused.slice(0, 6).map((tool) => tool.name),
        tokens: sumBy(unused, (tool) => tool.tokens),
      },
      action: { tab: 'settings', anchor: 'inventory' },
    })
  }

  // 3) 单会话反复压缩：说明预算/策略可能偏紧，而不是“压缩本身越多越好”。
  const heavy = sessions.filter((session) => number(session.compactions) >= 2)
  if (heavy.length > 0) {
    const top = heavy.slice().sort((left, right) => number(right.compactions) - number(left.compactions))[0]
    results.push({
      id: 'repeated-compaction',
      severity: 'info',
      values: {
        sessions: heavy.length,
        compactions: sumBy(heavy, (session) => session.compactions),
        topSession: top && top.id ? top.id : null,
        topTitle: top && top.title ? top.title : null,
        topCompactions: top ? number(top.compactions) : 0,
      },
      action: { tab: 'settings', anchor: 'config' },
    })
  }

  // 4) 压缩失败：比“压缩次数”更值得优先处理。
  const failures = logs.filter((entry) => entry && entry.outcome === 'failure')
  if (failures.length > 0) {
    const last = failures[failures.length - 1]
    results.push({
      id: 'compaction-failures',
      severity: 'warn',
      values: {
        count: failures.length,
        lastAt: last && last.at ? last.at : null,
        message: last && last.message ? String(last.message).slice(0, 240) : null,
      },
      action: { tab: 'events' },
    })
  }

  // 5) 有 token 但没有价格：费用图会缺一块，提示补价格表。
  const unknown = sessions.filter((session) => positive(session.tokens) && session.cost === null)
  if (unknown.length > 0) {
    results.push({
      id: 'unknown-pricing',
      severity: 'info',
      values: {
        sessions: unknown.length,
        models: modelList(unknown),
        tokens: sumBy(unknown, (session) => session.tokens),
        custom: Boolean(pricing.custom),
      },
      action: { tab: 'settings', anchor: 'pricing' },
    })
  }

  // 6) 费用异常会话：用中位数而不是平均值，避免被单个极值带偏。
  const costs = sessions.map((session) => session.cost).filter((cost) => typeof cost === 'number' && Number.isFinite(cost) && cost > 0)
  if (costs.length >= 4) {
    const center = median(costs)
    const top = sessions
      .filter((session) => typeof session.cost === 'number' && Number.isFinite(session.cost))
      .slice()
      .sort((left, right) => right.cost - left.cost)[0]
    if (center > 0 && top && top.cost >= center * 2.5) {
      results.push({
        id: 'cost-outlier',
        severity: 'info',
        values: {
          sessionId: top.id || null,
          title: top.title || null,
          cost: top.cost,
          median: center,
          multiple: top.cost / center,
        },
        action: { tab: 'trend', sessionId: top.id || null },
      })
    }
  }

  // 7) 价格表过期：官方调价后费用/节省估算会静默偏差，没有人会主动发现。
  const updatedAt = typeof pricing.updatedAt === 'string' ? Date.parse(pricing.updatedAt) : Number.NaN
  const nowMs = Number.isFinite(input.now) ? input.now : Date.now()
  if (Number.isFinite(updatedAt)) {
    const days = Math.floor((nowMs - updatedAt) / 86400000)
    if (days >= PRICING_STALE_DAYS) {
      results.push({
        id: 'pricing-stale',
        severity: 'info',
        values: { days, updatedAt: pricing.updatedAt, thresholdDays: PRICING_STALE_DAYS },
        action: { tab: 'settings', anchor: 'pricing' },
      })
    }
  }

  // 8) 缓存命中率低：系统提示词前缀不稳定（含时间戳 / 会话 id / 随机量）会让每次请求都 miss 前缀缓存。
  const hitSessions = sessions.filter((session) => typeof session.cacheHit === 'number' && Number.isFinite(session.cacheHit) && positive(session.tokens))
  if (hitSessions.length >= 3) {
    const hitTokens = sumBy(hitSessions, (session) => session.tokens)
    const weighted = sumBy(hitSessions, (session) => session.cacheHit * number(session.tokens)) / (hitTokens || 1)
    if (hitTokens >= 200000 && weighted < 0.3) {
      results.push({
        id: 'cache-hit-low',
        severity: 'info',
        values: { share: weighted, sessions: hitSessions.length, tokens: hitTokens },
        action: { tab: 'settings', anchor: 'config' },
      })
    }
  }

  // 9) 已接近错误线但该会话从未压缩过：触发线可能太靠后，或者压缩没真正生效。
  const budgetTokens = number(budget.tokens)
  const errorAt = number(budget.errorAt) || 0.9
  const currentTokens = number(latest && latest.totalTokens)
  const compactedSessions = new Set(logs.map((entry) => entry && entry.sessionId).filter(Boolean))
  const latestId = latest && typeof latest.id === 'string' ? latest.id : null
  if (budgetTokens > 0 && currentTokens > 0 && currentTokens / budgetTokens >= Math.max(0, errorAt - 0.05) && (!latestId || !compactedSessions.has(latestId))) {
    results.push({
      id: 'near-limit-not-compacted',
      severity: 'warn',
      values: { ratio: currentTokens / budgetTokens, tokens: currentTokens, budget: budgetTokens, errorAt },
      action: { tab: 'settings', anchor: 'config' },
      // 一键启用控制行（压缩）——这是这条洞察最直接的处理方式。
      apply: { path: '/status/config/preset', body: { enable: true }, label: 'insightApplyEnableCompaction' },
    })
  }

  // 10) 预算一直没确认：所有比例提醒都建立在默认 128k 上，可能整体失真。
  if (onboarding.budgetConfirmed !== true && sessions.length > 0 && budgetTokens > 0) {
    results.push({
      id: 'budget-unconfirmed',
      severity: 'info',
      values: { tokens: budgetTokens, sessions: sessions.length },
      action: { tab: 'settings', anchor: 'config' },
      // 一键确认预算，让后续比例提醒基于真实窗口。
      apply: { path: '/status/onboarding', body: { budgetConfirmed: true }, label: 'insightApplyConfirmBudget' },
    })
  }

  // 11) 分析窗口被 limit 截断：结论只覆盖最近一部分会话，别当成全量。
  const coverage = analytics.coverage && typeof analytics.coverage === 'object' ? analytics.coverage : null
  if (coverage && number(coverage.scanned) > 0 && number(coverage.total) > number(coverage.scanned)) {
    results.push({
      id: 'analytics-truncated',
      severity: 'info',
      values: { scanned: number(coverage.scanned), total: number(coverage.total), limit: number(coverage.limit) },
      action: { tab: 'trend' },
      // 一键把扫描窗口放宽到上限（200），让结论覆盖更多会话。
      apply: { path: '/status/config', body: { analyticsLimit: 200 }, label: 'insightApplyWidenWindow' },
    })
  }

  // 首次运行状态由面板的 Onboarding 卡单独承担，不在这里重复成一张洞察卡。
  return results.slice(0, 10)
}

/**
 * 把控制面、配置能力、首次运行状态和测量结果折成健康检查。
 * health 只回答“核心控制是否可信”，不把“费用未知”这类非致命项算成失败。
 *
 * @param {{
 *   control?: any,
 *   configEditable?: boolean,
 *   onboarding?: any,
 *   latest?: any,
 *   version?: string,
 * }} input
 */
export function buildHealth(input = {}) {
  const control = input.control && typeof input.control === 'object' ? input.control : {}
  const onboarding = input.onboarding && typeof input.onboarding === 'object' ? input.onboarding : {}
  const checks = []
  const push = (id, ok, values) => checks.push({ id, ok: Boolean(ok), values: values || {} })

  push('control', Boolean(control.active), { mode: control.mode || null })
  if (control.presetMountable) push('preset', Boolean(control.presetMountable && control.presetMounted), {})
  push('config', Boolean(input.configEditable), {})
  push('budget', Boolean(onboarding.budgetConfirmed), { tokens: number(input.onboarding && input.onboarding.budgetTokens) })
  push('measurement', Boolean(input.latest && number(input.latest.totalTokens) > 0), {
    at: input.latest && input.latest.at ? input.latest.at : null,
  })
  // 节假日表覆盖：内置表按年份维护，跨年不补就会把节假日按工作日计价（静默偏差）。
  // 这只是提醒，不影响 healthy —— 否则每年元旦整个面板都会报「异常」。
  const holidayYears = input.holidays && Array.isArray(input.holidays.years) ? input.holidays.years : null
  if (holidayYears) {
    const year = number(input.year) || new Date().getFullYear()
    push('holidays', holidayYears.includes(String(year)), {
      year,
      years: holidayYears,
      builtinYears: Array.isArray(input.holidays.builtinYears) ? input.holidays.builtinYears : [],
    })
  }

  // 只有这两项是「软提醒」：未覆盖年份、最近一次没有测量，都不改变整体健康判定。
  const soft = new Set(['measurement', 'holidays'])
  const required = checks.filter((check) => !soft.has(check.id))
  return {
    healthy: required.every((check) => check.ok),
    checks,
    version: typeof input.version === 'string' ? input.version : null,
  }
}
