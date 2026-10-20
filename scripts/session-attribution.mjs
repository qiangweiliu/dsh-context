// 会话成本归因：新增/缓存 token、按工具统计输出体积、工具 schema 体积、压缩与重试。
//   node scripts/session-attribution.mjs <session.v4.jsonl.zstd>
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
if (!file) throw new Error('用法：node scripts/session-attribution.mjs <*.jsonl.zstd>')

const callName = new Map() // callId -> tool name
const perTool = new Map() // tool name -> { calls, chars, errors }
let missTokens = 0
let cacheTokens = 0
let outputTokens = 0
let steps = 0
let toolSchemaChars = 0
let toolSchemaCount = 0
const bigResults = []
let compactionSummaryChars = 0
let compactionPruned = 0
let compactions = 0
let retries = 0
let turns = 0

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
      const usage = data.usage
      if (!usage) break
      steps += 1
      missTokens += usage.inputTokens ?? 0
      cacheTokens += usage.cacheReadTokens ?? 0
      outputTokens += usage.outputTokens ?? 0
      break
    }
    case 'request/header': {
      const tools = data.header?.tools ?? []
      if (toolSchemaCount === 0) {
        toolSchemaCount = tools.length
        toolSchemaChars = JSON.stringify(tools).length
      }
      break
    }
    case 'tool/call': {
      callName.set(data.callId, data.name)
      const entry = perTool.get(data.name) ?? { calls: 0, chars: 0, errors: 0 }
      entry.calls += 1
      perTool.set(data.name, entry)
      break
    }
    case 'tool/result': {
      const message = data.message ?? {}
      const callId = message.toolCallId ?? ''
      const name = callName.get(callId) ?? message.source?.kind ?? 'unknown'
      const chars = (message.content ?? []).reduce((s, b) => s + (typeof b?.text === 'string' ? b.text.length : 0), 0)
      const entry = perTool.get(name) ?? { calls: 0, chars: 0, errors: 0 }
      entry.chars += chars
      if (message.isError) entry.errors += 1
      perTool.set(name, entry)
      if (chars > 20000) bigResults.push({ name, chars })
      break
    }
    case 'compaction/start':
      compactions += 1
      break
    case 'compaction/summary':
      compactionSummaryChars += (data.summary ?? []).reduce((s, b) => s + (typeof b?.text === 'string' ? b.text.length : 0), 0)
      break
    case 'compaction/prune':
      compactionPruned += data.shadowedTokenCount ?? 0
      break
    case 'llm/retry':
      retries += 1
      break
    default:
      break
  }
}

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const approxTokens = (chars) => Math.round(chars / 3.6)
const total = missTokens + cacheTokens

console.log(`轮 ${turns} · 步 ${steps} · 重试 ${retries} · 压缩 ${compactions}`)
console.log(`\n输入：新增 ${fmt(missTokens)} · 缓存命中 ${fmt(cacheTokens)} · 总 ${fmt(total)} · 缓存占比 ${((cacheTokens / Math.max(1, total)) * 100).toFixed(1)}%`)
console.log(`输出：${fmt(outputTokens)} tokens（输出/新增输入 = ${(outputTokens / Math.max(1, missTokens)).toFixed(2)}）`)
if (toolSchemaCount > 0) {
  console.log(`工具 schema：${toolSchemaCount} 个 · ${fmt(toolSchemaChars)} 字符（约 ${fmt(approxTokens(toolSchemaChars))} tokens）——每步都随请求发送`)
}

console.log('\n按工具统计输出体积（字符 → 约 tokens）：')
const rows = [...perTool].sort((a, b) => b[1].chars - a[1].chars)
for (const [name, entry] of rows.slice(0, 12)) {
  console.log(`  ${name.padEnd(16)} 调用 ${String(entry.calls).padStart(4)} 次 · ${fmt(entry.chars).padStart(10)} 字符 ≈ ${fmt(approxTokens(entry.chars)).padStart(8)} tokens${entry.errors ? ` · 报错 ${entry.errors}` : ''}`)
}
const totalResultChars = rows.reduce((s, [, e]) => s + e.chars, 0)
console.log(`  合计 ${fmt(totalResultChars)} 字符 ≈ ${fmt(approxTokens(totalResultChars))} tokens`)

console.log(`\n单条 >20k 字符的结果：${bigResults.length} 条，合计 ${fmt(bigResults.reduce((s, r) => s + r.chars, 0))} 字符`)
console.log(`压缩：${compactions} 次 · 剪掉 ${fmt(compactionPruned)} tokens · 摘要 ${fmt(approxTokens(compactionSummaryChars))} tokens（摘要/剪掉 = ${((approxTokens(compactionSummaryChars) / Math.max(1, compactionPruned)) * 100).toFixed(0)}%）`)
