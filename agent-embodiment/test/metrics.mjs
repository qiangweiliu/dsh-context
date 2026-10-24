/**
 * 纯离线测试：会话日志折叠与聚合口径（不依赖 Cordis / DSH）。
 *
 * 运行：node test/metrics.mjs
 */
import { foldSession, sessionDetail, summarizeFolds } from '../metrics.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const now = Date.now()
const t0 = now - 2 * 60 * 60 * 1000
const events = [
  { type: 'session/title', seq: 1, time: t0, data: { title: '测试会话' } },
  { type: 'turn/start', seq: 2, time: t0 + 100, data: { turn: 1 } },
  { type: 'step/start', seq: 3, time: t0 + 120, data: { turn: 1, step: 1 } },
  {
    type: 'assistant/message',
    seq: 4,
    time: t0 + 1100,
    data: { turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 900, outputTokens: 50, totalTokens: 1050 }, message: { source: { provider: 'deepseek', model: 'deepseek-chat' } } },
  },
  { type: 'turn/end', seq: 5, time: t0 + 1200, data: { turn: 1 } },
  { type: 'turn/start', seq: 6, time: t0 + 2000, data: { turn: 2 } },
  { type: 'step/start', seq: 7, time: t0 + 2020, data: { turn: 2, step: 1 } },
  { type: 'compaction/start', seq: 8, time: t0 + 2100, data: { turn: 2, compactionId: 'c1' } },
  { type: 'compaction/summary', seq: 9, time: t0 + 4100, data: { turn: 2, compactionId: 'c1', shadowedTokenCount: 1234, summary: [{ type: 'text', text: 'summary' }], usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } } },
  { type: 'compaction/end', seq: 10, time: t0 + 4100, data: { turn: 2, compactionId: 'c1' } },
  { type: 'tool/call', seq: 11, time: t0 + 4200, data: { turn: 2, step: 1, name: 'read' } },
  { type: 'agent/inbox/spliced', seq: 12, time: t0 + 4300, data: {} },
  {
    type: 'assistant/message',
    seq: 13,
    time: t0 + 5000,
    data: { turn: 2, step: 1, usage: { inputTokens: 20, cacheReadTokens: 0, outputTokens: 10, totalTokens: 30 }, message: { source: { provider: 'deepseek', model: 'deepseek-chat' } } },
  },
  { type: 'turn/end', seq: 14, time: t0 + 5200, data: { turn: 2 } },
]

const fold = foldSession({ id: 'session-test', createdAt: t0, cwd: '/work' }, events)
check('标题取最后的 session/title', fold.title === '测试会话', fold.title)
check('汇总 usage（含压缩摘要调用）', fold.usage.total === 1110 && fold.usage.cacheRead === 900, fold.usage)
check('请求数 / 轮数 / 工具调用', fold.requests.length === 2 && fold.counts.turns === 2 && fold.counts.toolCalls === 1, fold.counts)
check('缓存命中率', Math.abs(fold.cacheHit - 900 / 1030) < 1e-9, fold.cacheHit)
check('成本按模型价格估算（含压缩摘要）', fold.cost !== null && Math.abs(fold.cost - 0.00095) < 1e-9, fold.cost)
check('压缩轮数与耗时', fold.counts.compactions === 1 && fold.compactions[0].durationMs === 2000, fold.compactions[0])
check('压缩 shadowed tokens', fold.compactions[0].shadowedTokens === 1234, fold.compactions[0])
check('压缩摘要 usage 进入总账', fold.compactions[0].usage?.total === 30 && fold.compactions[0].cost !== null, fold.compactions[0])
check('时间线包含压缩/注入', fold.timeline.some((item) => item.kind === 'compaction') && fold.timeline.some((item) => item.kind === 'inject'), fold.timeline)
check('活跃时长按 turn 计算', fold.activeMs === 1100 + 3200, fold.activeMs)
check('按日桶覆盖全部事件', fold.daily.length === 1 && fold.daily[0].tokens === 1110 && fold.daily[0].requests === 2, fold.daily)

const summary = summarizeFolds([fold], { now, days: 7 })
check('聚合 KPI：会话/tokens', summary.kpi.sessions === 1 && summary.kpi.tokens === 1110, summary.kpi)
check('聚合 KPI：压缩/注入计数', summary.kpi.compactions === 1 && summary.kpi.injections === 1, summary.kpi)
check('聚合 KPI 与日图一致', summary.kpi.tokens === summary.daily.reduce((sum, day) => sum + day.tokens, 0), { kpi: summary.kpi.tokens, daily: summary.daily.reduce((sum, day) => sum + day.tokens, 0) })
check('7 天桶补齐', summary.daily.length === 7, summary.daily.length)
check('会话卡片字段', summary.sessions[0].id === 'session-test' && summary.sessions[0].title === '测试会话', summary.sessions[0])

// 跨区间会话：KPI 只应统计区间内的日桶，而不是整段会话。
const spanning = foldSession({ id: 'session-span', createdAt: now - 20 * 24 * 3600 * 1000 }, [
  { type: 'assistant/message', seq: 1, time: now - 20 * 24 * 3600 * 1000, data: { usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }, message: { source: { provider: 'deepseek', model: 'deepseek-chat' } } } },
  { type: 'assistant/message', seq: 2, time: now - 1000, data: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, message: { source: { provider: 'deepseek', model: 'deepseek-chat' } } } },
])
const spanningSummary = summarizeFolds([spanning], { now, days: 7 })
check('区间 KPI 只统计区间内用量', spanningSummary.kpi.tokens === 15, { kpi: spanningSummary.kpi.tokens, session: spanning.usage.total })
check('区间 KPI 与日图一致（跨区间）', spanningSummary.kpi.tokens === spanningSummary.daily.reduce((sum, day) => sum + day.tokens, 0), spanningSummary.daily)

const detail = sessionDetail(fold)
check('会话详情：请求序列', detail.requests.length === 2 && detail.requests[0].prompt === 1000, detail.requests)
check('会话详情：压缩标记', detail.compactions.length === 1 && detail.compactions[0].shadowedTokens === 1234, detail.compactions)
check('会话详情：请求带上最近一次压缩', detail.requests[0].compaction === null && detail.requests[1].compaction?.shadowedTokens === 1234, detail.requests.map((request) => request.compaction))

const unknown = foldSession({ id: 's2' }, [
  { type: 'assistant/message', seq: 1, time: now, data: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, message: { source: { provider: 'agnes', model: 'agnes-3.0-flash' } } } },
])
check('未知模型不伪造费用', unknown.cost === null, unknown.cost)
const custom = foldSession({ id: 's2b' }, [
  { type: 'assistant/message', seq: 1, time: now, data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }, message: { source: { provider: 'custom', model: 'deepseek-v4.1-flash' } } } },
], [{ match: 'deepseek-v4', input: 1, cacheRead: 0, output: 2 }])
check('自定义价格表可补充内置未覆盖的模型', custom.cost !== null && Math.abs(custom.cost - 3) < 1e-9, custom.cost)
const old = foldSession({ id: 's3', createdAt: now - 40 * 24 * 3600 * 1000 }, [
  { type: 'assistant/message', seq: 1, time: now - 40 * 24 * 3600 * 1000, data: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
])
const range = summarizeFolds([old], { now, days: 7 })
check('范围外的会话被过滤', range.kpi.sessions === 0, range.kpi.sessions)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[metrics] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[metrics] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
