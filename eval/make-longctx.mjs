// 生成长上下文变体：同一批 GSM8K 题，前面塞 12 条无关历史问答（约 3k tokens），
// 用来测「上下文变长后指令保持/抗干扰」——这才是提示词真正能起作用的地方。
import { readFileSync, writeFileSync } from 'node:fs'

const N_DISTRACT = 12
const src = process.argv[2] || 'eval/questions.jsonl'
const out = process.argv[3] || 'eval/questions-longctx.jsonl'
const rows = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

const clean = (solution) => solution.replace(/####.*$/s, '').trim().slice(0, 700)

const built = rows.map((row, i) => {
  const blocks = []
  for (let k = 1; k <= N_DISTRACT; k += 1) {
    const pick = rows[(i + k * 7) % rows.length]
    blocks.push(`问：${pick.question}\n答：${clean(pick.solution)}`)
  }
  const question = [
    '下面是我之前处理过的一些问答记录，只作背景，可能与最后的问题无关：',
    '',
    ...blocks,
    '',
    '---',
    '现在请回答最后这个问题（只需要回答这个问题）：',
    row.question,
  ].join('\n\n')
  return { ...row, question, longctx: { distractors: N_DISTRACT, chars: question.length } }
})

writeFileSync(out, `${built.map((r) => JSON.stringify(r)).join('\n')}\n`)
const avgChars = Math.round(built.reduce((s, r) => s + r.question.length, 0) / built.length)
console.log(`wrote ${out}: ${built.length} 题，平均题面 ${avgChars} 字符（约 ${Math.round(avgChars / 3.6)} tokens），每条 ${N_DISTRACT} 段干扰`)
