// 推理档位对照：同一批题分别用 low / high 跑，记录总输出 tokens、思考字符、耗时与正确率。
// 需要 dsh --json（拿 usage）；答案从 final 事件取。
//   node eval/effort-test.mjs --tiers low,high --limit 10 [--file eval/questions.jsonl] [--extract number|math]
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const ROOT = resolve(import.meta.dirname, '..')
const DSH = process.env.DSH_BIN || `${homedir()}/.local/bin/dsh`
const WORKDIR = '/tmp/effort-eval-work'
const TIERS = flag('tiers', 'low,high').split(',').map((t) => t.trim()).filter(Boolean)
const LIMIT = Number(flag('limit', '10'))
const FILE = flag('file', 'eval/questions.jsonl')
const EXTRACT = flag('extract', 'number')
const OUT = flag('out', `eval/results/effort-${EXTRACT}.jsonl`)
const TIMEOUT_MS = Number(flag('timeout', '240')) * 1000
const WORKERS = Number(flag('workers', '4'))

const questions = readFileSync(resolve(ROOT, FILE), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(0, LIMIT)

function extractFinal(stdout) {
  const finals = [...stdout.matchAll(/"type":"final","text":"((?:[^"\\]|\\.)*)"/g)]
  if (finals.length === 0) return ''
  try {
    return JSON.parse(`"${finals[finals.length - 1][1]}"`)
  } catch {
    return finals[finals.length - 1][1]
  }
}

function extractMath(text) {
  const marked = [...text.matchAll(/(?:答案|answer)\s*[:：]\s*(.+)/gi)]
  if (marked.length > 0) return marked[marked.length - 1][1].trim()
  const boxes = [...text.matchAll(/\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
  if (boxes.length > 0) return boxes[boxes.length - 1][1].trim()
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : ''
}

function lastNumber(text) {
  const matches = [...String(text).matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
  if (matches.length === 0) return null
  return Number(matches[matches.length - 1][0].replace(/,/g, ''))
}

function runOne(question, tier) {
  return new Promise((resolveTask) => {
    const patch = resolve(ROOT, `eval/prompts/effort-${tier}.yml`)
    const argv = ['--profile', 'headless', '--patch', patch, '--json', question.question]
    const started = Date.now()
    const child = spawn(DSH, argv, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const seconds = Math.round((Date.now() - started) / 100) / 10
      const text = extractFinal(stdout)
      const usages = [...stdout.matchAll(/"usage":\{"inputTokens":(\d+),"outputTokens":(\d+)/g)].map((m) => ({ input: Number(m[1]), output: Number(m[2]) }))
      const thinkingChars = [...stdout.matchAll(/"type":"thinking","text":"((?:[^"\\]|\\.)*)"/g)].reduce((sum, m) => sum + m[1].length, 0)
      const gold = EXTRACT === 'math' ? question.gold : lastNumber(question.gold)
      const pred = EXTRACT === 'math' ? extractMath(text) : lastNumber(text)
      const ok = EXTRACT === 'math' ? null : status === 'ok' && pred !== null && gold !== null && Math.abs(pred - gold) < 1e-4
      const row = {
        id: question.id,
        tier,
        status,
        ok,
        pred,
        gold,
        seconds,
        outTokens: usages.reduce((s, u) => s + u.output, 0),
        maxInput: usages.length > 0 ? Math.max(...usages.map((u) => u.input)) : null,
        steps: usages.length,
        thinkingChars,
        answerChars: text.length,
      }
      appendFileSync(resolve(ROOT, OUT), `${JSON.stringify(row)}\n`)
      console.log(`[${tier}] ${question.id} ${status} out=${row.outTokens} think=${thinkingChars} ${seconds}s`)
      resolveTask(row)
    }
    let timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('timeout')
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('close', (code) => finish(code === 0 ? 'ok' : `exit-${code}`))
  })
}

const tasks = []
for (const question of questions) for (const tier of TIERS) tasks.push({ question, tier })
console.log(`[effort] ${tasks.length} 次（${questions.length} 题 × ${TIERS.join('/')}）→ ${OUT}`)

const queue = [...tasks]
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (queue.length > 0) {
    const task = queue.shift()
    await runOne(task.question, task.tier)
  }
}))
console.log('[effort] 完成')
