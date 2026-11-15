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
check('洞察最多 10 条且 id 不重复', base.length <= 10 && new Set(ids).size === ids.length, ids)

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

// 节假日表覆盖：跨年不补日期会静默把节假日按工作日计价，这里只做软提醒，不影响 healthy。
const holidayMiss = buildHealth({
  control: { active: true, presetMountable: false },
  configEditable: true,
  onboarding: { budgetConfirmed: true },
  holidays: { years: ['2026'], builtinYears: ['2026'] },
  year: 2027,
})
const holidayCheck = holidayMiss.checks.find((item) => item.id === 'holidays')
check('内置节假日表未覆盖当年时给出 holidays 提醒', Boolean(holidayCheck) && holidayCheck.ok === false && holidayCheck.values.year === 2027, holidayCheck)
check('节假日提醒不改变整体 healthy', holidayMiss.healthy === true, holidayMiss.healthy)

const holidayCovered = buildHealth({
  control: { active: true, presetMountable: false },
  configEditable: true,
  onboarding: { budgetConfirmed: true },
  holidays: { years: ['2026', '2027'], builtinYears: ['2026'] },
  year: 2027,
})
check('补充日期后 holidays 检查通过', holidayCovered.checks.find((item) => item.id === 'holidays')?.ok === true, holidayCovered.checks)
check('未传 holidays 时不产生该检查项', noPreset.checks.every((item) => item.id !== 'holidays'), noPreset.checks.map((item) => item.id))

// ── 新增规则：缓存命中 / 贴近线未压缩 / 预算未确认 / 分析窗口截断 ──
const insightIds = (list) => list.map((item) => item.id)

const cacheSessions = [
  { id: 'a', tokens: 120000, cacheHit: 0.1, cost: 1 },
  { id: 'b', tokens: 130000, cacheHit: 0.12, cost: 1 },
  { id: 'c', tokens: 140000, cacheHit: 0.15, cost: 1 },
]
check('缓存命中低时给出 cache-hit-low', insightIds(buildInsights({ analytics: { sessions: cacheSessions } })).includes('cache-hit-low'))
const warmSessions = cacheSessions.map((session) => ({ ...session, cacheHit: 0.8 }))
check('缓存命中高时不提示', !insightIds(buildInsights({ analytics: { sessions: warmSessions } })).includes('cache-hit-low'))

const nearLimit = buildInsights({
  analytics: { sessions: [{ id: 's1', tokens: 1000, cost: 1 }] },
  latest: { id: 's1', totalTokens: 120000 },
  budget: { tokens: 128000, errorAt: 0.9 },
})
check('贴近错误线且从未压缩时提示 near-limit-not-compacted', insightIds(nearLimit).includes('near-limit-not-compacted'))
const compacted = buildInsights({
  analytics: { sessions: [{ id: 's1', tokens: 1000, cost: 1 }] },
  latest: { id: 's1', totalTokens: 120000 },
  budget: { tokens: 128000, errorAt: 0.9 },
  logs: [{ sessionId: 's1', outcome: 'success' }],
})
check('已压缩过就不再提示', !insightIds(compacted).includes('near-limit-not-compacted'))

check(
  '预算未确认且有会话时提示 budget-unconfirmed',
  insightIds(buildInsights({ analytics: { sessions: [{ id: 's1', tokens: 1000 }] }, budget: { tokens: 128000 }, onboarding: {} })).includes('budget-unconfirmed'),
)
check(
  '预算已确认时不提示',
  !insightIds(buildInsights({ analytics: { sessions: [{ id: 's1', tokens: 1000 }] }, budget: { tokens: 128000 }, onboarding: { budgetConfirmed: true } })).includes('budget-unconfirmed'),
)

check(
  '分析窗口被截断时提示 analytics-truncated',
  insightIds(buildInsights({ analytics: { sessions: [], coverage: { scanned: 40, total: 120, limit: 40 } } })).includes('analytics-truncated'),
)
check(
  '未截断时不提示',
  !insightIds(buildInsights({ analytics: { sessions: [], coverage: { scanned: 40, total: 40, limit: 40 } } })).includes('analytics-truncated'),
)

check('洞察结果最多 10 条', buildInsights({ analytics: { sessions: cacheSessions }, latest: { id: 'a', totalTokens: 120000 }, budget: { tokens: 128000 }, onboarding: {}, logs: [] }).length <= 10)

// ── 洞察的一键处理（apply）──
const applyOf = (list, id) => list.find((item) => item.id === id)?.apply || null
const richInsights = buildInsights({
  analytics: {
    sessions: Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      tokens: 120000,
      cost: index === 0 ? 9 : 0.5,
      compactions: index === 0 ? 3 : 0,
      cacheHit: 0.05,
    })),
    coverage: { scanned: 40, total: 400, limit: 40 },
    toolUsage: {},
  },
  latest: { id: 's0', totalTokens: 127000, breakdown: { toolsTokens: 90000 } },
  inventory: { tools: [{ name: 'a', tokens: 900 }, { name: 'b', tokens: 800 }, { name: 'c', tokens: 700 }] },
  budget: { tokens: 128000, errorAt: 0.9 },
  onboarding: { budgetConfirmed: false },
  pricing: { updatedAt: '2020-01-01', custom: false },
  logs: [],
})
const enableCompaction = applyOf(richInsights, 'near-limit-not-compacted')
check('接近上限未压缩洞察带一键启用压缩', enableCompaction?.path === '/status/config/preset' && enableCompaction.body?.enable === true, enableCompaction)
const confirmBudget = applyOf(richInsights, 'budget-unconfirmed')
check('预算未确认洞察带一键确认', confirmBudget?.path === '/status/onboarding' && confirmBudget.body?.budgetConfirmed === true, confirmBudget)
const widen = applyOf(richInsights, 'analytics-truncated')
check('分析截断洞察带一键放宽窗口', widen?.path === '/status/config' && widen.body?.analyticsLimit === 200, widen)
check('apply 都指向 /status 下的路径', richInsights.filter((item) => item.apply).every((item) => item.apply.path.startsWith('/status/')), richInsights.filter((item) => item.apply).map((item) => item.apply.path))
check('apply 都带本地化 label', richInsights.filter((item) => item.apply).every((item) => typeof item.apply.label === 'string' && item.apply.label.length > 0))

const failed = checks.filter((item) => !item.ok)
console.log(`\n[insights] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[insights] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
