// GSM8K 50 题 × 2 组（baseline / optimized）跑分器。在 WSL 里执行。
//   node eval/run.mjs --workers 3 [--limit N] [--out eval/results/run1.jsonl]
// 断点续跑：已完成的 (题目, 条件) 会跳过。
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const WORKERS = Number(flag('workers', '3'))
const LIMIT = Number(flag('limit', '0'))
const OUT = resolve(flag('out', 'eval/results/run1.jsonl'))
const TIMEOUT_MS = Number(flag('timeout', '300')) * 1000
const EXTRACT = flag('extract', 'number')
const TAIL_CHARS = Number(flag('tail', '160'))
const ROOT = resolve(import.meta.dirname, '..')
const DSH = process.env.DSH_BIN || `${homedir()}/.local/bin/dsh`
const WORKDIR = '/tmp/gsm8k-eval-work'

const PATCHES = {
  z: null,
  a: 'eval/prompts/a-format-only.yml',
  b: 'eval/prompts/b-persona-only.yml',
  c: 'eval/prompts/c-persona-protocol.yml',
  e: 'eval/prompts/e-protocol-injection.yml',
  al: 'eval/prompts/al-format-low.yml',
  cl: 'eval/prompts/cl-protocol-low.yml',
  am: 'eval/prompts/am-format-math.yml',
  cm: 'eval/prompts/cm-protocol-math.yml',
}
const CONDITIONS = flag('arms', 'a,b,c')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean)
  .map((key) => {
    if (!(key in PATCHES)) throw new Error(`未知对照臂：${key}（可选 ${Object.keys(PATCHES).join(',')}）`)
    return { key, patch: PATCHES[key] ? resolve(ROOT, PATCHES[key]) : null }
  })

const questions = readFileSync(resolve(ROOT, flag('questions', 'eval/questions.jsonl')), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const picked = LIMIT > 0 ? questions.slice(0, LIMIT) : questions

/** MATH 模式：优先 `答案:` 行，其次最后一个 \boxed{}，最后一行兜底。 */
function extractMath(text) {
  const marked = [...text.matchAll(/(?:答案|answer)\s*[:：]\s*(.+)/gi)]
  if (marked.length > 0) return marked[marked.length - 1][1].trim()
  const boxes = [...text.matchAll(/\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
  if (boxes.length > 0) return boxes[boxes.length - 1][1].trim()
  const lines = text.trim().split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : ''
}

/** 答案优先取 `答案:` / `answer:` 标记行，取不到再退回"最后一个数字"。 */
function answerOf(text) {
  const marked = text.match(/(?:答案|answer)\s*[:：]\s*[$¥]?\s*(-?\d[\d,]*(?:\.\d+)?)/i)
  if (marked) {
    const value = Number(marked[1].replace(/,/g, ''))
    if (Number.isFinite(value)) return value
  }
  return lastNumber(text)
}

/** 最后一个数字；作为 gold 解析与标记缺失时的兜底。 */
function lastNumber(text) {
  const re = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/g
  let match = null
  let found = null
  while ((match = re.exec(text)) !== null) found = match[0]
  if (found === null) return null
  const value = Number(found.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

mkdirSync(dirname(OUT), { recursive: true })
mkdirSync(WORKDIR, { recursive: true })
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      done.add(`${row.id}|${row.cond}`)
    } catch {}
  }
}

const tasks = []
for (const question of picked) {
  for (const condition of CONDITIONS) {
    if (!done.has(`${question.id}|${condition.key}`)) tasks.push({ question, condition })
  }
}
console.log(`[run] 待跑 ${tasks.length} 次（已完成 ${done.size}），并发 ${WORKERS}，超时 ${TIMEOUT_MS / 1000}s → ${OUT}`)
if (tasks.length === 0) process.exit(0)

function runOne({ question, condition }) {
  return new Promise((resolveTask) => {
    const argv = ['--profile', 'headless']
    if (condition.patch) argv.push('--patch', condition.patch)
    argv.push(question.question)
    const started = Date.now()
    const child = spawn(DSH, argv, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (status, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const seconds = Math.round((Date.now() - started) / 100) / 10
      const math = EXTRACT === 'math'
      const gold = math ? question.gold : lastNumber(question.gold)
      const pred = math ? extractMath(stdout) : answerOf(stdout)
      const ok = math ? null : status === 'ok' && pred !== null && gold !== null && Math.abs(pred - gold) < 1e-4
      const row = {
        id: question.id,
        cond: condition.key,
        status,
        ok,
        pred,
        gold,
        seconds,
        chars: stdout.length,
        tail: stdout.trim().slice(-TAIL_CHARS).replace(/\s+/g, ' '),
        ...extra,
      }
      appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      const mark = math ? (status === 'ok' ? '·' : status) : status === 'ok' ? (ok ? '✓' : '✗') : status
      console.log(`[${condition.key}] ${question.id} ${mark} pred=${pred} gold=${gold} ${seconds}s`)
      resolveTask(row)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('timeout', { stderr: stderr.slice(-200) })
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish('spawn-error', { stderr: String(error).slice(-200) }))
    child.on('close', (code) => finish(code === 0 ? 'ok' : `exit-${code}`, code === 0 ? {} : { stderr: stderr.slice(-200) }))
  })
}

const startedAt = Date.now()
let cursor = 0
let completed = 0
async function worker() {
  while (cursor < tasks.length) {
    const task = tasks[cursor]
    cursor += 1
    await runOne(task)
    completed += 1
    if (completed % 10 === 0) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      console.log(`[progress] ${completed}/${tasks.length} · ${elapsed}s`)
    }
  }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, tasks.length) }, () => worker()))

const rows = readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const summary = {}
for (const condition of CONDITIONS) {
  const own = rows.filter((r) => r.cond === condition.key)
  summary[condition.key] = {
    n: own.length,
    ok: EXTRACT === 'math' ? null : own.filter((r) => r.ok).length,
    acc: EXTRACT === 'math' ? null : own.length ? Math.round((own.filter((r) => r.ok).length / own.length) * 1000) / 10 : null,
    failed: own.filter((r) => r.status !== 'ok').length,
    avgSeconds: own.length ? Math.round((own.reduce((s, r) => s + r.seconds, 0) / own.length) * 10) / 10 : null,
  }
}
const elapsed = Math.round((Date.now() - startedAt) / 1000)
writeFileSync(resolve(ROOT, 'eval/results/summary.json'), `${JSON.stringify({ workers: WORKERS, elapsedSeconds: elapsed, summary }, null, 2)}\n`)
console.log(`[done] ${elapsed}s · ${JSON.stringify(summary)}`)
