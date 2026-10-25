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
  const kpi = analytics.kpi && typeof analytics.kpi === 'object' ? analytics.kpi : {}
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

  // 首次运行状态由面板的 Onboarding 卡单独承担，不在这里重复成一张洞察卡。
  void onboarding
  void budget

  return results.slice(0, 6)
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
  if (control.presetMountable) push('preset', Boolean(control.presetMounted), {})
  push('config', Boolean(input.configEditable), {})
  push('budget', Boolean(onboarding.budgetConfirmed), { tokens: number(input.onboarding && input.onboarding.budgetTokens) })
  push('measurement', Boolean(input.latest && number(input.latest.totalTokens) > 0), {
    at: input.latest && input.latest.at ? input.latest.at : null,
  })

  const required = checks.filter((check) => check.id !== 'measurement')
  return {
    healthy: required.every((check) => check.ok),
    checks,
    version: typeof input.version === 'string' ? input.version : null,
  }
}
