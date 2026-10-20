// 从 GSM8K test 集里等距抽 50 题（确定性，不依赖随机种子），写出题目清单。
import { readFileSync, writeFileSync } from 'node:fs'

const N = 50
const src = process.argv[2] || 'eval/data/gsm8k_test.jsonl'
const out = process.argv[3] || 'eval/questions.jsonl'
const lines = readFileSync(src, 'utf8').split('\n').filter(Boolean)
if (lines.length < N) throw new Error(`题目不够：${lines.length}`)

const rows = []
for (let i = 0; i < N; i += 1) {
  const index = Math.floor(((i + 0.5) * lines.length) / N)
  const row = JSON.parse(lines[index])
  const gold = (row.answer.split('####').pop() || '').trim()
  rows.push({ id: `gsm8k-${index}`, index, question: row.question, gold, solution: row.answer })
}
writeFileSync(out, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
console.log(`wrote ${out}: ${rows.length} 题（源 ${lines.length} 行，等距抽样）`)
console.log(rows.slice(0, 3).map((r) => `${r.id} gold=${r.gold} q=${r.question.slice(0, 60)}…`).join('\n'))
