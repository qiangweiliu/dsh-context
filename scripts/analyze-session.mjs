// 解压 DSH 会话日志并打印记录结构概况（用于分析每步请求的 token 去向）。
//   node scripts/analyze-session.mjs <session.v4.jsonl.zstd> [--types]
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
if (!file) throw new Error('用法：node scripts/analyze-session.mjs <*.jsonl.zstd> [--types]')

const stream = createReadStream(file).pipe(createZstdDecompress())
const rl = createInterface({ input: stream, crlfDelay: Infinity })

const counts = new Map()
let parsed = 0
let samples = []
for await (const line of rl) {
  if (!line.trim()) continue
  let record
  try {
    record = JSON.parse(line)
  } catch {
    continue
  }
  parsed += 1
  const type = record.type ?? record.kind ?? Object.keys(record).slice(0, 3).join('+')
  counts.set(type, (counts.get(type) ?? 0) + 1)
  if (samples.length < 6 && (record.type ?? '') !== 'message') samples.push(record)
}
console.log(`记录数 ${parsed}`)
console.log('类型分布:', [...counts].map(([k, v]) => `${k}=${v}`).join(' '))
for (const sample of samples) {
  const brief = JSON.stringify(sample)
  console.log('---', brief.slice(0, 400))
}
