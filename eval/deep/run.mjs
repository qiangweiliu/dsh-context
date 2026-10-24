#!/usr/bin/env node
/**
 * 50 题深度套件执行器。
 *
 *   node eval/deep/run.mjs --dry-run
 *   node eval/deep/run.mjs --category code --limit 3
 *   node eval/deep/run.mjs --workers 3 --out eval/results/deep-main.jsonl
 *
 * 依赖：本机 `dsh`（默认 ~/.local/bin/dsh，可用 DSH_BIN 覆盖）与可用的 headless profile。
 * 每道题使用独立工作目录；代码题在 agent 结束后写入隐藏测试再判分。
 */
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createFixture, TASKS } from '../agent-ab/fixture.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const ROOT = resolve(import.meta.dirname, '..', '..')
const DSH = process.env.DSH_BIN || join(homedir(), '.local', 'bin', 'dsh')
const PROFILE = flag('profile', 'headless')
const CONDITION = flag('condition', 'base')
const CONDITION_HOME = CONDITION === 'base' ? '/tmp/dsh-memory-base' : '/tmp/dsh-memory-plugin'
const CONDITION_PATCH = CONDITION === 'compact' ? resolve(ROOT, 'eval/deep/patches/control.yml') : ''
const PATCH = flag('patch', CONDITION_PATCH)
const SCAFFOLD_HOME = resolve(flag('scaffold-home', '/tmp/deep-scaffold'))
const WORK_ROOT = resolve(flag('work', '/tmp/deep-runs'))
const OUT = resolve(flag('out', `eval/results/deep-${Date.now()}.jsonl`))
const WORKERS = Number(flag('workers', '2'))
const LIMIT = Number(flag('limit', '0'))
const REPS = Math.max(1, Number(flag('reps', '1')))
const ONLY_REP = Number(flag('rep', '0'))
const TIMEOUT_MS = Number(flag('timeout', '600')) * 1000
const CATEGORY = flag('category', '')
const IDS = flag('ids', '').split(',').map((value) => value.trim()).filter(Boolean)
const KEEP = has('keep')
const DRY = has('dry-run')
const DSH_HOME = flag('ds-home', process.env.DSH_HOME || CONDITION_HOME)
const VERBOSE = has('verbose')
const QUESTIONS_PATH = resolve(ROOT, flag('questions', 'eval/deep/questions.jsonl'))

const questions = readFileSync(QUESTIONS_PATH, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

let picked = questions
if (CATEGORY) picked = picked.filter((item) => item.category === CATEGORY)
if (IDS.length > 0) picked = picked.filter((item) => IDS.includes(item.id))
if (LIMIT > 0) picked = picked.slice(0, LIMIT)

const counts = picked.reduce((map, item) => ({ ...map, [item.category]: (map[item.category] || 0) + 1 }), {})
console.log(`[deep] selected ${picked.length} questions (reps=${REPS}, workers=${WORKERS})`, counts)
if (DRY) {
  for (const item of picked) console.log(`  ${item.id}  ${item.category}  d${item.difficulty}  ${item.title}`)
  process.exit(0)
}
if (!existsSync(DSH)) {
  console.error(`[deep] dsh not found: ${DSH}（设置 DSH_BIN）`)
  process.exit(2)
}

mkdirSync(dirname(OUT), { recursive: true })
mkdirSync(WORK_ROOT, { recursive: true })
if (!existsSync(OUT)) writeFileSync(OUT, '')
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      done.add(`${row.id}|${row.rep}`)
    } catch {}
  }
}

const jobs = []
for (const item of picked) {
  for (let rep = 1; rep <= REPS; rep += 1) {
    if (ONLY_REP && rep !== ONLY_REP) continue
    if (!done.has(`${item.id}|${rep}`)) jobs.push({ item, rep })
  }
}
console.log(`[deep] queued ${jobs.length} runs (${done.size} already done) -> ${OUT}`)

const env = { ...process.env }
if (DSH_HOME) env.DSH_HOME = DSH_HOME
if (CONDITION === 'scaffold') {
  const skills = join(SCAFFOLD_HOME, '.agents')
  if (!existsSync(join(skills, 'skills'))) {
    console.error(`[deep] scaffold condition needs skills under ${skills}；先运行 scripts/agent-scaffold.mjs`)
    process.exit(2)
  }
  env.DSH_AGENTS_HOME = skills
}
console.log(`[deep] condition=${CONDITION} dshHome=${DSH_HOME || '(default)'} patch=${PATCH || '(none)'}${CONDITION === 'scaffold' ? ` agents=${env.DSH_AGENTS_HOME}` : ''}`)

function runDsh({ cwd, prompt, timeoutMs, sessionId }) {
  return new Promise((resolveRun) => {
    // 启动器只解析自己的 flag；--patch 必须排在 --json（内部 runner flag）之前。
    const argv = ['--profile', PROFILE]
    if (PATCH) argv.push('--patch', PATCH)
    argv.push('--json')
    if (sessionId) argv.push('--session-id', sessionId)
    // 大上下文题目会超过 argv 限制；统一用 stdin 传任务（单个 `-` 是官方 stdin 标记）。
    argv.push('-')
    const started = Date.now()
    const child = spawn(DSH, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(prompt)
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const events = []
      const textParts = []
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          events.push(event)
          if (event.type === 'final' && typeof event.text === 'string') textParts.push(event.text)
          else if (event.type === 'text' && typeof event.text === 'string') textParts.push(event.text)
        } catch {}
      }
      const final = events.filter((event) => event.type === 'final').map((event) => event.text).filter((text) => typeof text === 'string').join('\n')
      const toolCalls = events.filter((event) => event.type === 'tool_call').length
      const toolNames = []
      const skillNames = []
      for (const event of events) {
        if (event.type !== 'tool_call') continue
        const name = event.name ?? event.data?.name
        if (typeof name === 'string') toolNames.push(name)
        if (name === 'skill') {
          const raw = event.arguments ?? event.data?.arguments
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {})
          const match = text.match(/"name"\s*:\s*"([^"]+)"/u)
          if (match) skillNames.push(match[1])
        }
      }
      const usage = { input: 0, output: 0, cacheRead: 0 }
      for (const event of events) {
        const value = event.type === 'status' ? event.usage : null
        if (!value) continue
        usage.input += Number(value.inputTokens) || 0
        usage.output += Number(value.outputTokens) || 0
        usage.cacheRead += Number(value.cacheReadTokens) || 0
      }
      resolveRun({
        status,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        final: final || textParts.join(''),
        toolCalls,
        toolNames,
        skillNames,
        chars: stdout.length,
        stderr: stderr.slice(-1200),
        events,
        usage,
        sessionId: events.find((event) => event.type === 'session')?.sessionId ?? null,
      })
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('timeout')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { stderr += String(error); finish('spawn-error') })
    child.on('close', (code) => finish(code === 0 ? 'ok' : `exit-${code}`))
  })
}

function runCommand(command, commandArgs, cwd, timeoutMs = 60000) {
  return new Promise((resolveRun) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) })
    })
  })
}

const stripFence = (text) => String(text || '').replace(/^```[a-zA-Z]*\s*/u, '').replace(/\s*```$/u, '').trim()
const stripAnswer = (text) => String(text || '')
  .replace(/^(?:答案|answer)\s*[:：]\s*/iu, '')
  .replace(/^["'`]+|["'`]+$/gu, '')
  .replace(/[。.]$/u, '')
  .trim()
const markedAnswer = (text) => {
  const matches = [...String(text || '').matchAll(/(?:答案|answer)\s*[:：]\s*([^\n]+)/giu)]
  return matches.length > 0 ? stripAnswer(matches[matches.length - 1][1]) : stripAnswer(stripFence(text))
}
const lastNumber = (text) => {
  const matches = [...String(text || '').matchAll(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/gu)]
  if (matches.length === 0) return null
  const value = Number(matches[matches.length - 1][0].replace(/,/gu, ''))
  return Number.isFinite(value) ? value : null
}
const normalizeText = (text) => String(text || '').toLowerCase().replace(/\s+/gu, ' ').trim()
/** 精确串比较忽略空白与逗号后的空格；用于 id 列表、日期、URL 等。 */
const normalizeExact = (text) => normalizeText(text).replace(/\s+/gu, '')

function deepEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
  }
  return a === b
}

function fixFrac(value) {
  let text = value
  const patterns = [
    [/\\frac\s*(\\[A-Za-z]+)(\d+)/gu, '\\frac{$1}{$2}'],
    [/\\frac\s*(\d)(\d+)/gu, '\\frac{$1}{$2}'],
    [/\\frac\s*([A-Za-z])([A-Za-z0-9])/gu, '\\frac{$1}{$2}'],
    [/\\frac\s*(\d+)(\\[A-Za-z]+|\d)/gu, '\\frac{$1}{$2}'],
  ]
  for (let round = 0; round < 3; round += 1) {
    const before = text
    for (const [pattern, replacement] of patterns) text = text.replace(pattern, replacement)
    if (text === before) break
  }
  return text
}

function unwrapCommand(text, command) {
  let value = text
  for (;;) {
    const marker = `\\${command}{`
    const start = value.indexOf(marker)
    if (start < 0) return value
    let depth = 0
    let end = -1
    for (let index = start + marker.length - 1; index < value.length; index += 1) {
      if (value[index] === '{') depth += 1
      else if (value[index] === '}') {
        depth -= 1
        if (depth === 0) { end = index; break }
      }
    }
    if (end < 0) return value
    value = value.slice(0, start) + value.slice(start + marker.length, end) + value.slice(end + 1)
  }
}

function normalizeMath(text) {
  let value = String(text || '').trim()
  value = unwrapCommand(value, 'boxed')
  value = unwrapCommand(value, 'fbox')
  value = value.replace(/\$/gu, '').replace(/\\\(|\\\)|\\\[|\\\]/gu, '')
  value = value.replace(/\\(left|right|displaystyle|textstyle|quad|qquad)/gu, '')
  value = value.replace(/\\dfrac|\\tfrac/gu, '\\frac')
  value = value.replace(/√\s*(\d+|[A-Za-z])/gu, '\\sqrt{$1}').replace(/√/gu, '\\sqrt')
  value = value.replace(/π/gu, '\\pi')
  value = fixFrac(value)
  value = value.replace(/\\text\{([^}]*)\}/gu, '$1').replace(/\\mathrm\{([^}]*)\}/gu, '$1')
  value = value.replace(/\\sqrt(\d+)/gu, '\\sqrt{$1}').replace(/\\sqrt([a-zA-Z])(?![a-zA-Z])/gu, '\\sqrt{$1}')
  value = value.replace(/\^\{([^}]*)\}/gu, '^$1').replace(/_\{([^}]*)\}/gu, '_$1')
  value = value.replace(/\\circ/gu, '°').replace(/\\% /gu, '%')
  value = value.replace(/\s+/gu, '')
  return value.replace(/[。.]$/u, '')
}

function mathEqual(pred, gold) {
  const left = normalizeMath(stripAnswer(pred))
  const right = normalizeMath(gold)
  if (left === right) return true
  const numeric = (value) => {
    let text = value
    const frac = /^\\frac\{([^{}]+)\}\{([^{}]+)\}$/u.exec(text)
    if (frac) return Number(frac[1]) / Number(frac[2])
    if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text)
    return null
  }
  const a = numeric(left)
  const b = numeric(right)
  if (a !== null && b !== null) return Math.abs(a - b) < 1e-9
  // 答案带单位（如 "1152 cups"）时，只要 gold 是纯数值就取最后一个数字比较。
  if (b !== null) {
    const found = lastNumber(left)
    if (found !== null && Math.abs(found - b) < 1e-9) return true
  }
  const split = (value) => value.split(',').map((part) => part.trim()).filter(Boolean).sort()
  const as = split(left)
  const bs = split(right)
  return as.length > 0 && as.length === bs.length && as.every((value, index) => value === bs[index])
}

function sympyEqual(pred, gold) {
  try {
    const output = execFileSync('python3', [resolve(ROOT, 'eval/deep/math-equal.py'), String(pred), String(gold)], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.trim() === '1'
  } catch {
    return false
  }
}

function grade(item, result, dir) {
  const verify = item.verify || { type: 'exact' }
  const answer = result.final
  if (verify.type === 'math') {
    const pred = markedAnswer(answer)
    if (mathEqual(pred, item.gold)) return { correct: true, pred, detail: 'math-normalized' }
    if (sympyEqual(pred, item.gold)) return { correct: true, pred, detail: 'math-sympy' }
    return { correct: false, pred, detail: 'math-mismatch' }
  }
  if (verify.type === 'numeric') {
    const pred = lastNumber(markedAnswer(answer))
    const gold = Number(item.gold)
    const tolerance = verify.decimals !== undefined ? 0.5 * 10 ** -verify.decimals : 1e-4
    return { correct: pred !== null && Math.abs(pred - gold) <= tolerance, pred, detail: `tolerance=${tolerance}` }
  }
  if (verify.type === 'exact') {
    const pred = markedAnswer(answer)
    const forbidden = (verify.forbidden || []).filter((text) => normalizeText(answer).includes(normalizeText(text)))
    const correct = normalizeExact(pred) === normalizeExact(item.gold) && forbidden.length === 0
    return { correct, pred, detail: forbidden.length ? `forbidden=${forbidden.join(',')}` : 'exact' }
  }
  if (verify.type === 'contains') {
    const lower = normalizeText(answer)
    const missing = (verify.required || []).filter((text) => !lower.includes(normalizeText(text)))
    const forbidden = (verify.forbidden || []).filter((text) => lower.includes(normalizeText(text)))
    return { correct: missing.length === 0 && forbidden.length === 0, pred: stripFence(answer).slice(0, 400), detail: JSON.stringify({ missing, forbidden }) }
  }
  if (verify.type === 'json') {
    const match = String(answer).match(/\{[\s\S]*\}/u)
    if (!match) return { correct: false, pred: null, detail: 'no JSON object' }
    try {
      const parsed = JSON.parse(match[0])
      return { correct: deepEqual(parsed, item.gold), pred: parsed, detail: verify.exactKeys ? 'json-exact' : 'json' }
    } catch (error) {
      return { correct: false, pred: null, detail: `invalid JSON: ${error.message}` }
    }
  }
  if (verify.type === 'tests') {
    return { correct: null, pred: null, detail: 'tests are graded after the hidden test run' }
  }
  if (verify.type === 'agentic') {
    return { correct: null, pred: null, detail: 'agentic verify runs after the agent finishes' }
  }
  if (verify.type === 'rubric') {
    const lower = normalizeText(answer)
    const hits = (verify.criteria || []).filter((criterion) => lower.includes(normalizeText(criterion)))
    return { correct: null, manual: true, pred: stripFence(answer).slice(0, 600), detail: `rubric hits ${hits.length}/${verify.criteria.length}: ${hits.join(',')}` }
  }
  return { correct: false, pred: null, detail: `unknown verify ${verify.type}` }
}

async function runOne({ item, rep }) {
  const id = item.id
  const dir = join(WORK_ROOT, `${id}-r${rep}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  if (item.category === 'agentic') {
    createFixture(dir, item.agentic.task)
  } else if (item.files) {
    for (const [path, content] of Object.entries(item.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`)
  }

  const perTurnTimeout = Math.min(TIMEOUT_MS, (item.timeoutSec || 600) * 1000)
  let result
  if (Array.isArray(item.turns) && item.turns.length > 0) {
    let sessionId = null
    const totals = { seconds: 0, toolCalls: 0, chars: 0, toolNames: [], skillNames: [], usage: { input: 0, output: 0, cacheRead: 0 } }
    for (const turn of item.turns) {
      const turnResult = await runDsh({ cwd: dir, prompt: turn, timeoutMs: perTurnTimeout, sessionId })
      sessionId = sessionId || turnResult.sessionId
      if (!sessionId) throw new Error('headless did not report a session id for continuation')
      totals.seconds += turnResult.seconds
      totals.toolCalls += turnResult.toolCalls
      totals.chars += turnResult.chars
      totals.toolNames.push(...turnResult.toolNames)
      totals.skillNames.push(...turnResult.skillNames)
      totals.usage.input += turnResult.usage.input
      totals.usage.output += turnResult.usage.output
      totals.usage.cacheRead += turnResult.usage.cacheRead
      result = turnResult
      if (turnResult.status !== 'ok') break
    }
    result = { ...result, ...totals, sessionId }
  } else {
    result = await runDsh({ cwd: dir, prompt: item.prompt, timeoutMs: perTurnTimeout })
  }
  let graded = grade(item, result, dir)

  if (item.category === 'code' && item.tests) {
    for (const [path, content] of Object.entries(item.tests)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    const testPaths = Object.keys(item.tests)
    const tests = await runCommand('node', ['--test', ...testPaths], dir, 60000)
    graded = { correct: tests.code === 0, pred: tests.code, detail: tests.code === 0 ? 'hidden tests passed' : `hidden tests failed: ${(tests.stderr || tests.stdout).slice(-600)}` }
  }

  if (item.category === 'agentic') {
    const verify = await TASKS[item.agentic.task].verify(dir, result.final)
    graded = { correct: Boolean(verify.pass), pred: verify.pass, detail: verify.detail }
  }

  const row = {
    id,
    rep,
    cond: CONDITION,
    category: item.category,
    difficulty: item.difficulty,
    turns: Array.isArray(item.turns) ? item.turns.length : 1,
    status: result.status,
    correct: graded.correct,
    manual: graded.manual === true,
    pred: graded.pred,
    gold: item.gold ?? null,
    detail: graded.detail,
    seconds: result.seconds,
    toolCalls: result.toolCalls,
    toolNames: result.toolNames || [],
    skillNames: result.skillNames || [],
    chars: result.chars,
    usage: result.usage || null,
    sessionId: result.sessionId || null,
    answer: String(result.final || '').slice(-2000),
    stderr: result.status === 'ok' ? '' : result.stderr,
  }
  if (!KEEP) rmSync(dir, { recursive: true, force: true })
  return row
}

let cursor = 0
let completed = 0
const startedAt = Date.now()
const rows = []
async function worker() {
  for (;;) {
    const index = cursor
    cursor += 1
    if (index >= jobs.length) return
    const job = jobs[index]
    let row
    try {
      row = await runOne(job)
    } catch (error) {
      row = {
        id: job.item.id,
        rep: job.rep,
        cond: CONDITION,
        category: job.item.category,
        status: 'runner-error',
        correct: false,
        pred: null,
        gold: job.item.gold ?? null,
        detail: error instanceof Error ? error.message : String(error),
        seconds: 0,
        toolCalls: 0,
        chars: 0,
        answer: '',
        stderr: String(error?.stack || '').slice(-800),
      }
    }
    rows.push(row)
    appendFileSync(OUT, `${JSON.stringify(row)}\n`)
    completed += 1
    const mark = row.manual ? 'manual' : row.correct === null ? '-' : row.correct ? '✓' : '✗'
    console.log(`[${row.category}] ${row.id} r${row.rep} ${mark} ${row.seconds}s ${row.detail || ''}`)
    if (VERBOSE) console.log(row.answer.slice(-500))
    if (completed % 5 === 0) console.log(`[progress] ${completed}/${jobs.length} · ${Math.round((Date.now() - startedAt) / 1000)}s`)
  }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, () => worker()))

const byCategory = {}
for (const row of rows) {
  const bucket = byCategory[row.category] || { n: 0, graded: 0, correct: 0, manual: 0, failed: 0, seconds: 0 }
  bucket.n += 1
  bucket.seconds += row.seconds
  if (row.manual) bucket.manual += 1
  if (row.status !== 'ok') bucket.failed += 1
  if (row.correct !== null && !row.manual) {
    bucket.graded += 1
    if (row.correct) bucket.correct += 1
  }
  byCategory[row.category] = bucket
}
const summary = { startedAt: new Date(startedAt).toISOString(), elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), out: OUT, profile: PROFILE, condition: CONDITION, byCategory }
console.log(`[deep] done ${Math.round(summary.elapsedSeconds)}s`, JSON.stringify(byCategory, null, 2))
const summaryPath = resolve(ROOT, OUT.replace(/\.jsonl$/u, '-summary.json'))
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`[deep] summary: ${summaryPath}`)
