// 输出 token 构成：按内容块类型（reasoning / text / tool-call）统计字符与估算 tokens，
// 并看每步输出的分布、推理块是否进入后续上下文。
//   node scripts/output-composition.mjs <session.v4.jsonl.zstd>
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
if (!file) throw new Error('用法：node scripts/output-composition.mjs <*.jsonl.zstd>')

const byType = new Map() // type -> { chars, blocks }
const stepOut = [] // { turn, step, chars, tokens }
const bigSteps = []
let stepsWithReasoning = 0
let steps = 0
let toolArgChars = 0
const toolArgByTool = new Map()

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
  if (record.type === 'assistant/message') {
    steps += 1
    const content = data.message?.content ?? []
    let chars = 0
    let hasReasoning = false
    for (const block of content) {
      const type = block?.type ?? 'unknown'
      let size = 0
      if (typeof block?.text === 'string') size = block.text.length
      else if (Array.isArray(block?.content)) size = JSON.stringify(block.content).length
      else size = JSON.stringify(block ?? {}).length
      const entry = byType.get(type) ?? { chars: 0, blocks: 0 }
      entry.chars += size
      entry.blocks += 1
      byType.set(type, entry)
      chars += size
      if (type === 'reasoning') hasReasoning = true
    }
    if (hasReasoning) stepsWithReasoning += 1
    const tokens = data.usage?.outputTokens ?? 0
    stepOut.push({ turn: data.turn, step: data.step, chars, tokens })
    if (tokens > 3000) bigSteps.push({ turn: data.turn, step: data.step, tokens, chars })
  } else if (record.type === 'tool/call') {
    let args = data.arguments ?? ''
    if (typeof args !== 'string') args = JSON.stringify(args)
    toolArgChars += args.length
    const name = data.name ?? 'unknown'
    toolArgByTool.set(name, (toolArgByTool.get(name) ?? 0) + args.length)
  }
}

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const t = (chars) => chars / 3.6
const totalChars = [...byType.values()].reduce((s, e) => s + e.chars, 0)

console.log(`步数 ${steps} · 含推理块的步 ${stepsWithReasoning}（${((stepsWithReasoning / Math.max(1, steps)) * 100).toFixed(0)}%）`)
console.log('\n内容块构成（字符 → 约 tokens）：')
for (const [type, entry] of [...byType].sort((a, b) => b[1].chars - a[1].chars)) {
  console.log(`  ${type.padEnd(12)} ${fmt(entry.chars).padStart(10)} 字符 ≈ ${fmt(t(entry.chars)).padStart(8)} tokens · ${fmt(entry.blocks)} 块 · 占输出字符 ${((entry.chars / Math.max(1, totalChars)) * 100).toFixed(1)}%`)
}
console.log(`\n工具调用参数：${fmt(toolArgChars)} 字符 ≈ ${fmt(t(toolArgChars))} tokens`)
for (const [name, chars] of [...toolArgByTool].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${name.padEnd(12)} ${fmt(chars)} 字符 ≈ ${fmt(t(chars))} tokens`)
}

const tokens = stepOut.map((s) => s.tokens)
const sorted = [...tokens].sort((a, b) => a - b)
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
const sum = tokens.reduce((a, b) => a + b, 0)
console.log(`\n每步输出 tokens：均值 ${fmt(sum / Math.max(1, tokens.length))} · p50 ${fmt(pct(50))} · p90 ${fmt(pct(90))} · p99 ${fmt(pct(99))} · max ${fmt(Math.max(...tokens))}`)
console.log(`>3000 tokens 的步：${bigSteps.length} 个，合计 ${fmt(bigSteps.reduce((s, b) => s + b.tokens, 0))} tokens（占输出 ${((bigSteps.reduce((s, b) => s + b.tokens, 0) / Math.max(1, sum)) * 100).toFixed(0)}%）`)
const top = bigSteps.sort((a, b) => b.tokens - a.tokens).slice(0, 5)
console.log(`最重的 5 步：${top.map((b) => `T${b.turn}S${b.step}:${fmt(b.tokens)}`).join(' ')}`)
