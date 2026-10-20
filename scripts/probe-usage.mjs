// 探查 assistant/message 的 usage 口径：按轮打印连续记录，看是否为单步全量 prompt。
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
const targetTurn = Number(process.argv[3] ?? 0)
const rl = createInterface({ input: createReadStream(file).pipe(createZstdDecompress()), crlfDelay: Infinity })

const rows = []
for await (const line of rl) {
  if (!line.trim()) continue
  let record
  try {
    record = JSON.parse(line)
  } catch {
    continue
  }
  if (record.type !== 'assistant/message') continue
  const d = record.data ?? {}
  const usage = d.usage ?? {}
  rows.push({ turn: d.turn, step: d.step, input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, blocks: (d.message?.content ?? []).map((b) => b.type).join(',') })
}

const buckets = [
  [0, 500],
  [500, 2000],
  [2000, 10000],
  [10000, 50000],
  [50000, 150000],
  [150000, 1e9],
]
console.log('按 inputTokens 分桶：')
for (const [lo, hi] of buckets) {
  const n = rows.filter((r) => r.input >= lo && r.input < hi).length
  console.log(`  ${lo.toLocaleString()}–${hi.toLocaleString()}: ${n}`)
}
const sampleTurn = targetTurn || rows[Math.floor(rows.length / 2)]?.turn
const turnRows = rows.filter((r) => r.turn === sampleTurn)
console.log(`\n第 ${sampleTurn} 轮（${turnRows.length} 步）的输入序列：`)
console.log(turnRows.slice(0, 24).map((r) => `s${r.step}:${r.input}${r.cacheRead ? `(cache ${r.cacheRead})` : ''}`).join(' '))
