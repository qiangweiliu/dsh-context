#!/usr/bin/env node
/**
 * analytics 折叠性能基线：给跨会话统计（analytics）一个可复现的 P50/P95 与内存参考。
 *
 * 只测纯函数 `metrics.foldSession()`（宿主路由真正做的重活），不启动 DSH、不依赖 app.asar。
 * 用法：
 *   node scripts/bench-analytics.mjs            # 默认 40 会话 × 200 事件 × 5 轮
 *   node scripts/bench-analytics.mjs --sessions 80 --events 400 --runs 3
 *
 * 输出：每轮耗时、P50/P95、峰值 RSS，写在 stdout；用于 LIMITATIONS 与 RELEASE-PLAN 的门禁记录。
 */
import { foldSession } from '../agent-embodiment/metrics.js'

const args = process.argv.slice(2)
const read = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

const SESSIONS = read('sessions', 40)
const EVENTS = read('events', 200)
const RUNS = read('runs', 5)

// 固定种子的线性同余，保证每次生成的夹具一致（不引入随机依赖）。
let seed = 20261110
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = (list) => list[Math.floor(random() * list.length)]

const MODELS = ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'unknown-model']
const TOOLS = ['read', 'write', 'grep', 'glob', 'bash', 'web_search', 'web_fetch']

function makeEvents(count, sessionIndex) {
  const start = Date.UTC(2026, 9, 1) + sessionIndex * 3600_000
  const events = [{ type: 'session/title', seq: 1, time: start, data: { title: `会话 ${sessionIndex}` } }]
  let seq = 2
  let time = start
  while (events.length < count) {
    const turn = Math.floor(events.length / 6) + 1
    time += 1000
    events.push({ type: 'turn/start', seq: seq++, time, data: { turn } })
    const model = pick(MODELS)
    events.push({
      type: 'assistant/message',
      seq: seq++,
      time: (time += 2000),
      data: {
        turn,
        step: 1,
        usage: {
          inputTokens: 500 + Math.floor(random() * 4000),
          cacheReadTokens: Math.floor(random() * 20000),
          cacheWriteTokens: Math.floor(random() * 1000),
          outputTokens: 200 + Math.floor(random() * 1200),
          totalTokens: 5000 + Math.floor(random() * 30000),
        },
        message: { source: { provider: 'deepseek', model } },
      },
    })
    for (let call = 0; call < 2; call += 1) {
      events.push({
        type: 'tool/result',
        seq: seq++,
        time: (time += 500),
        data: { turn, step: 1, toolName: pick(TOOLS), tokens: 200 + Math.floor(random() * 800) },
      })
    }
    events.push({ type: 'turn/end', seq: seq++, time: (time += 300), data: { turn } })
  }
  return events
}

const sessions = Array.from({ length: SESSIONS }, (_, index) => ({ id: `bench-${index}`, events: makeEvents(EVENTS, index) }))

const percentile = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]

const timings = []
for (let run = 0; run < RUNS; run += 1) {
  const startedAt = process.hrtime.bigint()
  let events = 0
  for (const session of sessions) {
    const fold = foldSession({ id: session.id }, session.events)
    events += fold?.timeline?.length ?? 0
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
  timings.push(elapsedMs)
  console.log(`run ${run + 1}: ${elapsedMs.toFixed(1)} ms（${SESSIONS} 会话 / ${SESSIONS * EVENTS} 事件）`)
}

const sorted = timings.slice().sort((a, b) => a - b)
const memory = process.memoryUsage()
console.log('')
console.log(`sessions=${SESSIONS} events=${EVENTS} runs=${RUNS}`)
console.log(`P50=${percentile(sorted, 0.5).toFixed(1)}ms  P95=${percentile(sorted, 0.95).toFixed(1)}ms  max=${sorted.at(-1).toFixed(1)}ms`)
console.log(`rss=${(memory.rss / 1024 / 1024).toFixed(1)}MB  heapUsed=${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB`)
