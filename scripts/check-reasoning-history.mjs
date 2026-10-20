// 检查发给模型的上下文中是否包含历史推理块（决定推理 token 是否复利）。
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'

const file = process.argv[2]
const rl = createInterface({ input: createReadStream(file).pipe(createZstdDecompress()), crlfDelay: Infinity })
const types = new Map()
let contexts = 0
let sample = null
for await (const line of rl) {
  if (!line.trim() || !line.includes('reasoning')) continue
  let record
  try {
    record = JSON.parse(line)
  } catch {
    continue
  }
  if (record.type !== 'request/context') continue
  contexts += 1
  const json = JSON.stringify(record.data)
  if (json.includes('"reasoning"')) {
    console.log('request/context 里出现 reasoning 标记，长度', json.length)
  }
  const messages = record.data?.messages ?? record.data?.context?.messages ?? []
  for (const message of messages) {
    const kinds = (message?.content ?? []).map((b) => b?.type ?? 'unknown')
    const key = `${message?.role}:${kinds.join('+')}`
    types.set(key, (types.get(key) ?? 0) + 1)
  }
  if (!sample) sample = { count: messages.length, roles: [...new Set(messages.map((m) => m?.role))], kinds: [...new Set(messages.flatMap((m) => (m?.content ?? []).map((b) => b?.type)))] }
}
console.log(`request/context 记录 ${contexts} 条`)
console.log('样例上下文：', JSON.stringify(sample))
for (const [key, count] of [...types].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${count} × ${key}`)
