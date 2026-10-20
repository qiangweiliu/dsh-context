// 汇总 effort 对照：正确率 / 输出 tokens / 思考字符 / 耗时。
//   node eval/summarize-effort.mjs <file.jsonl> [--math]
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const math = process.argv.includes('--math')
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const tiers = [...new Set(rows.map((r) => r.tier))]
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)
const round = (n) => Math.round(n * 10) / 10

console.log(`${file}（${math ? 'MATH L5' : 'GSM8K'}）`)
console.log('档位\t作答\t正确\t输出tok中位\t思考字符中位\t耗时中位\t总输出tok')
for (const tier of tiers) {
  const group = rows.filter((r) => r.tier === tier && r.status === 'ok')
  const correct = math ? group.length : group.filter((r) => r.ok).length
  console.log([tier, group.length, `${correct}/${group.length}`, median(group.map((r) => r.outTokens)), median(group.map((r) => r.thinkingChars)), `${round(median(group.map((r) => r.seconds)))}s`, group.reduce((s, r) => s + r.outTokens, 0)].join('\t'))
}
if (tiers.length === 2) {
  const [a, b] = tiers.map((tier) => rows.filter((r) => r.tier === tier && r.status === 'ok'))
  const outA = mean(a.map((r) => r.outTokens))
  const outB = mean(b.map((r) => r.outTokens))
  const secA = mean(a.map((r) => r.seconds))
  const secB = mean(b.map((r) => r.seconds))
  console.log(`\n${tiers[0]} 相对 ${tiers[1]}：输出 tokens ${((outA / outB - 1) * 100).toFixed(0)}%，耗时 ${((secA / secB - 1) * 100).toFixed(0)}%`)
}
