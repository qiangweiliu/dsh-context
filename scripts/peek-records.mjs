// 打印各类记录的样例，用于确定字段结构。
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
const want = new Set(['step/end', 'tool/result', 'tool/call', 'request/header', 'compaction/start', 'compaction/summary', 'compaction/prune', 'turn/end', 'llm/retry', 'assistant/attempt'])
const seen = new Map()
const rl = createInterface({ input: createReadStream(file).pipe(createZstdDecompress()), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let record
  try {
    record = JSON.parse(line)
  } catch {
    continue
  }
  if (!want.has(record.type)) continue
  if ((seen.get(record.type) ?? 0) >= 1) continue
  seen.set(record.type, 1)
  console.log(`=== ${record.type}\n${JSON.stringify(record).slice(0, 460)}`)
}
