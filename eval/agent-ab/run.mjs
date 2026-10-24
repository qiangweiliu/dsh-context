// A/B/C 对照：干净 DSH、仅安装 agent-embodiment、安装插件 + 脚手架具身。
// 每个任务使用独立夹具与独立会话；结果 JSONL 断点续跑。
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createFixture, TASKS } from './fixture.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const ROOT = resolve(import.meta.dirname, '..', '..')
const DSH = process.env.DSH_BIN || join(homedir(), '.local', 'bin', 'dsh')
const DSH_HOME = resolve(flag('ds-home', '/tmp/dsh-ab'))
const OUT = resolve(ROOT, flag('out', 'eval/results/plugin-ab.jsonl'))
const RUN_ROOT = resolve(flag('work', '/tmp/ab-runs'))
const TASKS_ARG = flag('tasks', Object.keys(TASKS).join(',')).split(',').map((x) => x.trim()).filter(Boolean)
const ARMS_ARG = flag('arms', 'base,plugin,scaffold').split(',').map((x) => x.trim()).filter(Boolean)
const REPS = Number(flag('reps', '3'))
const WORKERS = Number(flag('workers', '2'))
const TIMEOUT_MS = Number(flag('timeout', '240')) * 1000
const SKILLS_HOME = resolve(flag('agents-home', '/tmp/ab-agents'))
const SENSES_PATCH = resolve(flag('senses-patch', '/tmp/ab-senses.yml'))

const ARMS = {
  base: { profile: 'ab-base', agentsHome: null, patch: null, label: 'clean DSH' },
  plugin: { profile: 'ab-plugin-only', agentsHome: null, patch: null, label: 'agent-embodiment installed' },
  scaffold: { profile: 'ab-plugin', agentsHome: SKILLS_HOME, patch: SENSES_PATCH, label: 'plugin + scaffold embodiment' },
}
for (const task of TASKS_ARG) if (!TASKS[task]) throw new Error(`unknown task: ${task}`)
for (const arm of ARMS_ARG) if (!ARMS[arm]) throw new Error(`unknown arm: ${arm}`)
if (!existsSync(DSH)) throw new Error(`dsh not found: ${DSH}`)

mkdirSync(dirname(OUT), { recursive: true })
mkdirSync(RUN_ROOT, { recursive: true })
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const row = JSON.parse(line); done.add(`${row.task}|${row.arm}|${row.rep}`) } catch {}
  }
}
const jobs = []
for (const task of TASKS_ARG) for (const arm of ARMS_ARG) for (let rep = 1; rep <= REPS; rep += 1) {
  if (!done.has(`${task}|${arm}|${rep}`)) jobs.push({ task, arm, rep })
}
console.log(`[ab] ${jobs.length} runs queued (${done.size} done), workers=${WORKERS}, out=${OUT}`)

function usageOf(events) {
  let modelCalls = 0
  let outputTokens = 0
  let inputTokens = 0
  let cacheReadTokens = 0
  let lastContext = null
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (!usage) continue
    modelCalls += 1
    outputTokens += Number(usage.outputTokens) || 0
    inputTokens += Number(usage.inputTokens) || 0
    cacheReadTokens += Number(usage.cacheReadTokens) || 0
    lastContext = (Number(usage.inputTokens) || 0) + (Number(usage.cacheReadTokens) || 0)
  }
  return { modelCalls, outputTokens, inputTokens, cacheReadTokens, lastContext }
}

function parseSession(file) {
  const raw = execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const header = events.find((event) => event.type === 'session')
  const toolCalls = events.filter((event) => event.type === 'tool/call')
  const toolNames = toolCalls.map((event) => event.data?.name).filter(Boolean)
  const argsText = toolCalls.map((event) => String(event.data?.arguments ?? ''))
  const verified = argsText.some((text) => /npm\s+test|node\s+--test/.test(text))
  const start = events.find((event) => event.type === 'turn/start')?.time
  const end = [...events].reverse().find((event) => event.type === 'turn/end')?.time
  return {
    cwd: header?.cwd ?? null,
    steps: events.filter((event) => event.type === 'step/end').length,
    toolCalls: toolCalls.length,
    toolNames,
    verified,
    senseCalls: toolNames.filter((name) => name === 'sense_environment').length,
    skillCalls: toolNames.filter((name) => name === 'skill').length,
    durationMs: start && end ? end - start : null,
    ...usageOf(events),
  }
}

function findSession(runDir, startedAt) {
  const root = join(DSH_HOME, 'sessions')
  if (!existsSync(root)) return null
  const candidates = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (entry === 'session.v4.jsonl.zstd' && stat.mtimeMs >= startedAt - 2000) candidates.push({ path, mtime: stat.mtimeMs })
    }
  }
  walk(root)
  candidates.sort((a, b) => b.mtime - a.mtime)
  for (const candidate of candidates) {
    try {
      const first = execFileSync('zstd', ['-dc', candidate.path], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).split('\n')[0]
      const header = JSON.parse(first)
      if (header.cwd === runDir) return candidate.path
    } catch {}
  }
  return null
}

function runOne({ task, arm, rep }) {
  return new Promise((resolveRun) => {
    const id = `${task}-${arm}-r${rep}`
    const runDir = join(RUN_ROOT, id, 'repo')
    createFixture(runDir, task, { dirty: task === 'orientation' })
    const spec = ARMS[arm]
    const argv = ['--profile', spec.profile]
    if (spec.patch) argv.push('--patch', spec.patch)
    argv.push(TASKS[task].prompt)
    const env = { ...process.env, DSH_HOME }
    if (spec.agentsHome) env.DSH_AGENTS_HOME = spec.agentsHome
    else delete env.DSH_AGENTS_HOME
    const startedAt = Date.now()
    const child = spawn(DSH, argv, { cwd: runDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = async (status, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10
      let verification = { pass: false, detail: 'not run' }
      if (status === 'ok') {
        try { verification = await TASKS[task].verify(runDir, stdout.trim()) } catch (error) { verification = { pass: false, detail: `verify error: ${error.message}` } }
      }
      let session = null
      const sessionFile = findSession(runDir, startedAt)
      if (sessionFile) { try { session = parseSession(sessionFile) } catch (error) { session = { parseError: String(error.message) } } }
      const row = {
        task, arm, rep, status,
        pass: verification.pass,
        detail: verification.detail,
        seconds,
        final: stdout.trim().slice(-1200),
        stderr: stderr.trim().slice(-400),
        sessionFile,
        ...session,
        ...extra,
      }
      appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      console.log(`[${arm}] ${task}/r${rep} ${verification.pass ? 'PASS' : 'FAIL'} ${seconds}s tools=${row.toolCalls ?? '?'} verify=${row.verified ? 'Y' : 'N'} ${verification.pass ? '' : `— ${verification.detail.slice(0, 120)}`}`)
      resolveRun(row)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('timeout', { stderr: stderr.slice(-400) })
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish('spawn-error', { stderr: String(error).slice(-400) }))
    child.on('close', (code) => finish(code === 0 ? 'ok' : `exit-${code}`, code === 0 ? {} : { stderr: stderr.slice(-400) }))
  })
}

const started = Date.now()
let cursor = 0
let finished = 0
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor]
    cursor += 1
    await runOne(job)
    finished += 1
    if (finished % 6 === 0) console.log(`[progress] ${finished}/${jobs.length} · ${Math.round((Date.now() - started) / 1000)}s`)
  }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, () => worker()))

const rows = readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const selected = rows.filter((row) => TASKS_ARG.includes(row.task) && ARMS_ARG.includes(row.arm))
const round = (value, digits = 1) => value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits
const avg = (list) => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null
const summary = {}
for (const arm of ARMS_ARG) {
  const own = selected.filter((row) => row.arm === arm)
  summary[arm] = {
    label: ARMS[arm].label,
    runs: own.length,
    pass: own.filter((row) => row.pass).length,
    passRate: own.length ? round(own.filter((row) => row.pass).length / own.length * 100) : null,
    avgSeconds: round(avg(own.map((row) => row.seconds))),
    avgToolCalls: round(avg(own.map((row) => row.toolCalls ?? 0))),
    verified: own.filter((row) => row.verified).length,
    avgOutputTokens: round(avg(own.map((row) => row.outputTokens ?? 0))),
    avgContextTokens: round(avg(own.map((row) => row.lastContext ?? 0))),
    byTask: {},
  }
  for (const task of TASKS_ARG) {
    const taskRows = own.filter((row) => row.task === task)
    summary[arm].byTask[task] = {
      runs: taskRows.length,
      pass: taskRows.filter((row) => row.pass).length,
      avgSeconds: round(avg(taskRows.map((row) => row.seconds))),
      avgToolCalls: round(avg(taskRows.map((row) => row.toolCalls ?? 0))),
      verified: taskRows.filter((row) => row.verified).length,
    }
  }
}
const summaryPath = resolve(ROOT, 'eval/results/plugin-ab-summary.json')
writeFileSync(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), dshHome: DSH_HOME, reps: REPS, tasks: TASKS_ARG, summary }, null, 2)}\n`)
console.log(`[done] ${Math.round((Date.now() - started) / 1000)}s · ${summaryPath}`)
console.log(JSON.stringify(summary, null, 2))
