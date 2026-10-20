// 从 DSH 会话日志里统计"每一步请求"的成本结构：输入/输出/cache、工具结果体积、
// 重复调用、重试、压缩开销。输出一份可读报告。
//   node scripts/session-cost-report.mjs <session.v4.jsonl.zstd>
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
if (!file) throw new Error('用法：node scripts/session-cost-report.mjs <*.jsonl.zstd>')

const steps = [] // { turn, step, usage, textChars, toolCalls }
const calls = [] // { name, args, turn, step }
const results = [] // { name, chars, isError, turn, step }
const compactions = []
let retries = 0
let attempts = 0
let turns = 0
let usageSample = null

const rl = createInterface({ input: createReadStream(file).pipe(createZstdDecompress()), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let record
  try {
    record = JSON.parse(line)
  } catch {
    continue
  }
  const data = record.data ?? {}
  switch (record.type) {
    case 'turn/start':
      turns += 1
      break
    case 'assistant/message': {
      const usage = data.usage ?? data.message?.usage ?? null
      if (usage && !usageSample) usageSample = usage
      const content = data.message?.content ?? data.content ?? []
      const chars = content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0)
      steps.push({ turn: data.turn, step: data.step, usage, chars })
      break
    }
    case 'tool/call': {
      calls.push({ name: data.name, args: data.arguments, turn: data.turn, step: data.step })
      break
    }
    case 'tool/result': {
      const content = data.message?.content ?? []
      const chars = content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0)
      results.push({ name: null, chars, isError: Boolean(data.message?.isError), turn: data.turn, step: data.step })
      break
    }
    case 'compaction/start':
      compactions.push({ turn: data.turn, id: data.compactionId, shadowed: 0, summaryChars: 0 })
      break
    case 'compaction/prune': {
      const last = compactions[compactions.length - 1]
      if (last) last.shadowed += data.shadowedTokenCount ?? 0
      break
    }
    case 'compaction/summary': {
      const last = compactions[compactions.length - 1]
      if (last) last.summaryChars = (data.summary ?? []).reduce((s, b) => s + (typeof b?.text === 'string' ? b.text.length : 0), 0)
      break
    }
    case 'llm/retry':
      retries += 1
      break
    case 'assistant/attempt':
      attempts += 1
      break
    default:
      break
  }
}

const num = (value) => (typeof value === 'number' ? value : 0)
const withUsage = steps.filter((s) => s.usage)
const input = withUsage.map((s) => num(s.usage.inputTokens ?? s.usage.input_tokens))
const output = withUsage.map((s) => num(s.usage.outputTokens ?? s.usage.output_tokens))
const cached = withUsage.map((s) => num(s.usage.cachedTokens ?? s.usage.cacheHitTokens ?? 0))
const pct = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
const sum = (values) => values.reduce((a, b) => a + b, 0)
const fmt = (value) => value.toLocaleString('en-US')

console.log(`会话：${file.split('/').pop()}`)
console.log(`轮 ${turns} · 步 ${steps.length} · 工具调用 ${calls.length} · 工具结果 ${results.length} · 重试 ${retries} · 压缩 ${compactions.length} · 每轮步数 ${(steps.length / Math.max(1, turns)).toFixed(1)}`)
console.log(`usage 样例：${JSON.stringify(usageSample)}`)
if (withUsage.length > 0) {
  console.log(`\n输入 tokens：合计 ${fmt(sum(input))} · 单步均值 ${fmt(Math.round(sum(input) / input.length))} · p50 ${fmt(pct(input, 50))} · p90 ${fmt(pct(input, 90))} · max ${fmt(Math.max(...input))}`)
  console.log(`输出 tokens：合计 ${fmt(sum(output))} · 单步均值 ${fmt(Math.round(sum(output) / output.length))} · p90 ${fmt(pct(output, 90))}`)
  if (sum(cached) > 0) {
    console.log(`缓存命中 tokens：${fmt(sum(cached))}（命中率 ${((sum(cached) / sum(input)) * 100).toFixed(1)}%）`)
  }
  console.log(`输入/输出 比：${(sum(input) / Math.max(1, sum(output))).toFixed(1)} : 1`)
}

// 每轮内输入随步数增长（上下文膨胀）
const byTurn = new Map()
for (const s of withUsage) {
  if (!byTurn.has(s.turn)) byTurn.set(s.turn, [])
  byTurn.get(s.turn).push(num(s.usage.inputTokens ?? 0))
}
const growth = []
for (const [turn, values] of byTurn) {
  if (values.length < 4) continue
  growth.push({ turn, first: values[0], last: values[values.length - 1], steps: values.length })
}
if (growth.length > 0) {
  const avgFirst = Math.round(sum(growth.map((g) => g.first)) / growth.length)
  const avgLast = Math.round(sum(growth.map((g) => g.last)) / growth.length)
  const avgSteps = (sum(growth.map((g) => g.steps)) / growth.length).toFixed(1)
  console.log(`\n同轮内增长（≥4 步的轮，共 ${growth.length} 个）：首步均值 ${fmt(avgFirst)} → 末步均值 ${fmt(avgLast)}（×${(avgLast / Math.max(1, avgFirst)).toFixed(2)}），平均 ${avgSteps} 步/轮`)
  const worst = [...growth].sort((a, b) => b.last - a.last).slice(0, 3)
  console.log(`最重的 3 轮：${worst.map((g) => `T${g.turn} ${fmt(g.last)}tok/${g.steps}步`).join(' · ')}`)
}

// 工具结果体积
const totalResultChars = sum(results.map((r) => r.chars))
const errors = results.filter((r) => r.isError).length
console.log(`\n工具结果：合计 ${fmt(totalResultChars)} 字符（约 ${fmt(Math.round(totalResultChars / 3.6))} tokens）· 平均 ${fmt(Math.round(totalResultChars / Math.max(1, results.length)))} 字符/次 · 报错 ${errors} 次`)
const big = results.filter((r) => r.chars > 20000).length
console.log(`超 20k 字符的结果：${big} 次（合计 ${fmt(sum(results.filter((r) => r.chars > 20000).map((r) => r.chars)))} 字符）`)

// 重复调用（同 name + 同参数）
const key = (c) => `${c.name}|${c.args}`
const counts = new Map()
for (const c of calls) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1)
const duplicates = [...counts].filter(([, n]) => n > 1)
const dupExtra = duplicates.reduce((s, [, n]) => s + (n - 1), 0)
console.log(`\n重复工具调用：${duplicates.length} 组，多出 ${dupExtra} 次（占全部调用 ${((dupExtra / Math.max(1, calls.length)) * 100).toFixed(1)}%）`)
const topDup = duplicates.sort((a, b) => b[1] - a[1]).slice(0, 5)
for (const [k, n] of topDup) console.log(`  ×${n}  ${k.slice(0, 140)}`)

// 压缩
if (compactions.length > 0) {
  console.log(`\n压缩：${compactions.length} 次 · 被剪掉 ${fmt(sum(compactions.map((c) => c.shadowed)))} tokens · 摘要合计 ${fmt(sum(compactions.map((c) => c.summaryChars)))} 字符`)
  console.log(`  平均每次剪掉 ${fmt(Math.round(sum(compactions.map((c) => c.shadowed)) / compactions.length))} tokens，摘要 ${fmt(Math.round(sum(compactions.map((c) => c.summaryChars)) / compactions.length))} 字符`)
}
console.log(`\n重试：llm/retry ${retries} 次 · assistant/attempt ${attempts} 次`)
