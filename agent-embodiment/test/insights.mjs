/**
 * 纯离线测试：洞察卡与健康检查。
 *
 * 运行：node test/insights.mjs
 */
import { buildHealth, buildInsights } from '../insights.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const sessions = [
  { id: 'a', title: 'A', tokens: 120000, cost: 0.4, compactions: 3, model: 'deepseek-v4.1-flash' },
  { id: 'b', title: 'B', tokens: 30000, cost: 0.1, compactions: 0, model: 'deepseek-v4.1-flash' },
  { id: 'c', title: 'C', tokens: 20000, cost: 0.08, compactions: 0, model: 'unknown-x' },
  { id: 'd', title: 'D', tokens: 10000, cost: null, compactions: 0, model: 'unknown-x' },
  { id: 'e', title: 'E', tokens: 8000, cost: 0.02, compactions: 0, model: 'deepseek-v4.1-flash' },
]

const base = buildInsights({
  analytics: { kpi: { tokens: 188000 }, sessions },
  latest: {
    totalTokens: 10000,
    breakdown: { toolsTokens: 6000, systemTokens: 1500, historyTokens: 2000, userTokens: 500 },
  },
  inventory: {
    tools: [
      { name: 'read', tokens: 400 },
      { name: 'write', tokens: 500 },
      { name: 'bash', tokens: 600 },
      { name: 'search', tokens: 700 },
    ],
  },
  toolUsage: { read: 4 },
  logs: [{ outcome: 'failure', at: '2026-10-25T10:00:00.000Z', message: 'context still over budget' }],
  pricing: { custom: false },
  onboarding: { budgetConfirmed: false },
  budget: { tokens: 128000 },
})

const ids = base.map((item) => item.id)
check('工具定义占比过高生成洞察', ids.includes('tool-schema-share'), ids)
check('未使用工具生成洞察', ids.includes('unused-tools') && base.find((item) => item.id === 'unused-tools').values.count === 3, base.find((item) => item.id === 'unused-tools'))
check('重复压缩生成洞察', ids.includes('repeated-compaction') && base.find((item) => item.id === 'repeated-compaction').values.sessions === 1, base.find((item) => item.id === 'repeated-compaction'))
check('压缩失败优先生成洞察', ids.includes('compaction-failures') && base.find((item) => item.id === 'compaction-failures').severity === 'warn', base.find((item) => item.id === 'compaction-failures'))
check('未知价格生成洞察', ids.includes('unknown-pricing') && base.find((item) => item.id === 'unknown-pricing').values.sessions === 1, base.find((item) => item.id === 'unknown-pricing'))
check('费用异常会话生成洞察', ids.includes('cost-outlier') && base.find((item) => item.id === 'cost-outlier').values.sessionId === 'a', base.find((item) => item.id === 'cost-outlier'))
check('洞察最多 7 条且 id 不重复', base.length <= 7 && new Set(ids).size === ids.length, ids)

// 价格表时效：超过 30 天提示，未超时/字段缺失都不提示。
const stale = buildInsights({
  analytics: { sessions: [] },
  pricing: { updatedAt: '2026-10-24' },
  now: Date.parse('2026-12-01T00:00:00Z'),
})
check('价格表超过 30 天生成 pricing-stale', stale.some((item) => item.id === 'pricing-stale'), stale)
check('pricing-stale 带天数与阈值', stale.find((item) => item.id === 'pricing-stale')?.values?.days === 38 && stale.find((item) => item.id === 'pricing-stale')?.values?.thresholdDays === 30, stale.find((item) => item.id === 'pricing-stale')?.values)
const freshPricing = buildInsights({
  analytics: { sessions: [] },
  pricing: { updatedAt: '2026-10-24' },
  now: Date.parse('2026-11-01T00:00:00Z'),
})
check('价格表未过期不提示', !freshPricing.some((item) => item.id === 'pricing-stale'), freshPricing)
const noDatePricing = buildInsights({ analytics: { sessions: [] }, pricing: { custom: true }, now: Date.parse('2027-01-01T00:00:00Z') })
check('没有 updatedAt 时不误报', !noDatePricing.some((item) => item.id === 'pricing-stale'), noDatePricing)

const quiet = buildInsights({
  analytics: { sessions: [] },
  latest: { totalTokens: 1000, breakdown: { toolsTokens: 100 } },
  inventory: { tools: [] },
  logs: [],
  pricing: { custom: true },
  onboarding: { budgetConfirmed: true },
})
check('正常数据不硬造洞察', quiet.length === 0, quiet)

const healthy = buildHealth({
  control: { active: true, mode: 'idle', presetMountable: true, presetMounted: true },
  configEditable: true,
  onboarding: { budgetConfirmed: true },
  latest: { totalTokens: 1000, at: '2026-10-25T10:00:00.000Z' },
  version: '0.24.0',
})
check('核心控制齐全时 health=true', healthy.healthy === true && healthy.checks.every((item) => item.ok), healthy)
const unhealthy = buildHealth({
  control: { active: false, mode: null, presetMountable: true, presetMounted: false },
  configEditable: false,
  onboarding: { budgetConfirmed: false },
  latest: null,
})
check('控制行未挂载时 health=false', unhealthy.healthy === false, unhealthy)
check('健康检查包含 preset/config/budget', ['preset', 'config', 'budget'].every((id) => unhealthy.checks.some((item) => item.id === id && item.ok === false)), unhealthy.checks)
const noPreset = buildHealth({ control: { active: true, presetMountable: false }, configEditable: true, onboarding: { budgetConfirmed: true } })
check('不可挂载的 profile 不把 preset 算成失败', noPreset.healthy === true, noPreset)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[insights] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[insights] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
