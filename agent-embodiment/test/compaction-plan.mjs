/**
 * compaction-plan.js 的直接单测（不需要 Cordis / app.asar）。
 *
 * 这段是「压缩选哪一段历史」的阈值数学：keepFloor 的取值优先级、不动区（reserve）计算、
 * 达到 target 需要多少历史、最小 2 节点、最小 token 门槛。以前只能构造真实会话再观察
 * 压缩结果，现在可以逐条穷举边界。
 *
 * 运行：node test/compaction-plan.mjs
 */
import { planRegion } from '../compaction-plan.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

/** 生成 seq 从 1 开始、每条固定 token 的节点数组。 */
const nodesOf = (count, tokens) => Array.from({ length: count }, (_, index) => ({ seq: index + 1, tokens }))

// ── 结构筛选 ──
check('消息节点不足 2 条时返回 null', planRegion({ nodes: nodesOf(2, 100), totalTokens: 200, budget: 1000, target: 100 }) === null)
check('第 0 个节点（system）始终跳过', (() => {
  const plan = planRegion({
    nodes: [{ seq: 1, tokens: 10 }, { seq: 2, tokens: 300 }, { seq: 3, tokens: 300 }, { seq: 4, tokens: 300 }, { seq: 5, tokens: 300 }],
    totalTokens: 1210,
    budget: 2000,
    target: 400,
    keepTokens: 300,
  })
  return plan !== null && plan.start === 2
})())
check('非消息类型被过滤（tool/call 不进入可压范围）', (() => {
  const plan = planRegion({
    nodes: [
      { seq: 1, tokens: 10 },
      { seq: 2, tokens: 100 },
      { seq: 3, tokens: 100 },
      { seq: 4, tokens: 100 },
      { seq: 5, tokens: 100 },
    ],
    totalTokens: 410,
    budget: 1000,
    target: 200,
    keepTokens: 100,
    typeOf: (node) => (node.seq === 3 ? 'tool/call' : 'user/message'),
  })
  // seq3 被过滤 → 可压范围是 seq2、seq4；因此 end 必须是 4 而不是 5
  return plan !== null && plan.start === 2 && plan.end === 4 && plan.tokens === 200
})())
check('tool/result 属于可压历史', (() => {
  const plan = planRegion({
    nodes: [{ seq: 1, tokens: 10 }, { seq: 2, tokens: 300 }, { seq: 3, tokens: 300 }, { seq: 4, tokens: 300 }],
    totalTokens: 910,
    budget: 1000,
    target: 400,
    keepTokens: 300,
    typeOf: () => 'tool/result',
  })
  return plan !== null && plan.start === 2
})())

// ── keepFloor 取值优先级 ──
const base = (extra = {}) => planRegion({
  nodes: nodesOf(10, 100),
  totalTokens: 800,
  budget: 1000,
  target: 500,
  ...extra,
})
const withKeep = base({ keepTokens: 250 })
check('keepTokens 直接作为 keepFloor', withKeep?.tokens === 300 && withKeep.start === 2 && withKeep.end === 4, withKeep)
const withDefault = base({ keepTokens: 0, defaultKeepTokens: 400 })
check('defaultKeepTokens 优先于 budget 比例', withDefault !== null && withDefault.end === 4 && withDefault.tokens === 300, withDefault)
const withRatio = base({ keepTokens: 0, defaultKeepTokens: 0, budget: 2000 })
check('两者都缺省时用 budget×25%', withRatio !== null, withRatio)
check('budget 比例向上取整至少 1', planRegion({ nodes: nodesOf(4, 1), totalTokens: 4, budget: 2, target: 0, keepTokens: 0, defaultKeepTokens: 0 }) === null)

check('保留区都凑不够 keepFloor 时返回 null', planRegion({
  nodes: nodesOf(4, 100),
  totalTokens: 400,
  budget: 1000,
  target: 0,
  keepTokens: 1000,
}) === null)

check('候选不足 2 条时返回 null', planRegion({
  nodes: nodesOf(3, 100),
  totalTokens: 300,
  budget: 1000,
  target: 0,
  keepTokens: 200,
}) === null)

// ── 达到 target 的切点 ──
const enough = planRegion({ nodes: nodesOf(10, 100), totalTokens: 1000, budget: 1000, target: 700, keepTokens: 200 })
check('按 needed 找到切点（差额 300 → 覆盖 3 个节点）', enough?.tokens === 300 && enough.end === 4, enough)

const notEnough = planRegion({ nodes: nodesOf(10, 100), totalTokens: 1000, budget: 1000, target: 0, keepTokens: 200 })
check('可压不足时压到候选上限', notEnough !== null && notEnough.end === notEnough.start + (notEnough.tokens / 100) - 1, notEnough)

check('切点至少覆盖 2 个节点', (() => {
  const plan = planRegion({ nodes: nodesOf(10, 300), totalTokens: 3000, budget: 3000, target: 2900, keepTokens: 300 })
  return plan !== null && plan.tokens === 600
})())

check('所选 token 小于 200 门槛时返回 null', planRegion({
  nodes: nodesOf(10, 10),
  totalTokens: 60,
  budget: 1000,
  target: 50,
  keepTokens: 25,
}) === null)

// ── 节点 token 读取 ──
check('没有 tokens 时回落到 heuristicTokens', (() => {
  const plan = planRegion({
    nodes: [{ seq: 1, heuristicTokens: 10 }, { seq: 2, heuristicTokens: 300 }, { seq: 3, heuristicTokens: 300 }, { seq: 4, heuristicTokens: 300 }],
    totalTokens: 910,
    budget: 1000,
    target: 400,
    keepTokens: 300,
  })
  return plan !== null && plan.tokens === 600
})())

check('返回首尾 seq 与覆盖 token 数', (() => {
  const plan = planRegion({ nodes: nodesOf(10, 100), totalTokens: 800, budget: 1000, target: 500, keepTokens: 250 })
  return plan.start < plan.end && plan.tokens === (plan.end - plan.start + 1) * 100
})())

check('空/非法输入不抛错', planRegion({}) === null && planRegion({ nodes: null, totalTokens: 0, budget: 0, target: 0 }) === null)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[compaction-plan] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
