// 从 EleutherAI/hendrycks_math 的四个学科里挑 Level 5，等距抽 50 题。
// gold 取 solution 里最后一个 \boxed{...}（MATH 的标准写法）。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = 'eval/data'
const files = readdirSync(dir).filter((f) => /^math-.*\.json$/.test(f))
const pool = []
for (const file of files) {
  const rows = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')).rows.map((r) => r.row)
  for (const row of rows) {
    if (row.level !== 'Level 5') continue
    const boxes = [...row.solution.matchAll(/\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
    if (boxes.length === 0) continue
    const gold = boxes[boxes.length - 1][1].trim()
    if (!gold) continue
    pool.push({ subject: row.type, level: row.level, problem: row.problem, gold, solution: row.solution })
  }
}
const seen = new Set()
const unique = pool.filter((row) => {
  const key = `${row.subject}|${row.problem.slice(0, 80)}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
if (unique.length < 50) throw new Error(`Level 5 只有 ${unique.length} 题`)
const picked = []
for (let i = 0; i < 50; i += 1) picked.push(unique[Math.floor(((i + 0.5) * unique.length) / 50)])
const out = picked.map((row, i) => ({
  id: `math5-${i}`,
  subject: row.subject,
  question: row.problem,
  gold: row.gold,
  solution: row.solution,
}))
writeFileSync('eval/questions-math.jsonl', `${out.map((r) => JSON.stringify(r)).join('\n')}\n`)
const bySubject = {}
for (const row of out) bySubject[row.subject] = (bySubject[row.subject] ?? 0) + 1
console.log(`候选 ${unique.length} → 抽 50 题（${JSON.stringify(bySubject)}）`)
console.log(out.slice(0, 3).map((r) => `${r.id} [${r.subject}] gold=${r.gold}`).join('\n'))
