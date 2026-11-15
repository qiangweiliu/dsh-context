/**
 * routes-session.js 的直接单测（不需要 Cordis、不需要 app.asar）。
 *
 * 0.37.0 把会话预算 / 数据清理 / 会话级提示词文本 / 新增提示词这 6 条路由从
 * index.js 的 apply() 抽出后，这些分支终于可以喂假依赖直接验证。
 *
 * 运行：node test/routes-session.mjs
 */
import { EventEmitter } from 'node:events'

import { createSessionRoutes } from '../routes-session.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const jsonSender = (response) => (status, body) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

const requireMethod = (request, response, method) => {
  if (request.method === method) return true
  jsonSender(response)(405, { ok: false, error: 'method not allowed' })
  return false
}

const readJson = (request, response, onBody, limit = 256 * 1024, message = 'invalid json') => {
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > limit) return
    chunks.push(chunk)
  })
  request.on('end', () => {
    if (size > limit) return jsonSender(response)(413, { ok: false, error: 'payload too large' })
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return jsonSender(response)(400, { ok: false, error: message })
    }
    onBody(parsed, size)
  })
}

/** 记录所有依赖调用，便于断言「真的被调到了」。 */
const calls = {
  revisions: 0,
  budgets: new Map(),
  hydrated: null,
  atomicWrites: [],
  clearedToggles: 0,
  savedToggles: 0,
  promptText: [],
  clearedText: [],
  extraWrites: [],
}

let prompts = { existing: 'old' }
let placements = { existing: 'user' }

const routes = createSessionRoutes({
  jsonSender,
  requireMethod,
  readJson,
  bumpStatusRevision: () => { calls.revisions += 1 },
  latestSessionId: () => 'latest-session',
  setSessionBudget: (sessionId, tokens) => {
    if (!Number.isInteger(tokens) || tokens <= 0) return false
    calls.budgets.set(sessionId, tokens)
    return true
  },
  clearSessionBudget: (sessionId) => { calls.budgets.delete(sessionId) },
  listSessionBudgets: () => [...calls.budgets].map(([sessionId, tokens]) => ({ sessionId, tokens })),
  hydrateCompactionLog: (entries) => { calls.hydrated = entries },
  compactionLogPath: '/tmp/does-not-exist-embody.log',
  atomicWriteFile: (path, data) => { calls.atomicWrites.push([path, data]) },
  clearAllSessionToggles: () => { calls.clearedToggles += 1; return 0 },
  saveSessionToggles: () => { calls.savedToggles += 1 },
  setSessionPromptText: (sessionId, name, text) => { calls.promptText.push([sessionId, name, text]) },
  clearSessionPromptText: (sessionId, name) => { calls.clearedText.push([sessionId, name]) },
  getExtraPrompts: () => prompts,
  getExtraPromptPlacements: () => placements,
  writeExtraPrompts: (next, nextPlacements, response, send) => {
    calls.extraWrites.push([next, nextPlacements])
    prompts = { ...next }
    placements = { ...nextPlacements }
    send(202, { ok: true, accepted: prompts, placements })
  },
})

const makeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
  end(body) { this.body = body ?? '' },
})

const call = (handler, method, payload) => new Promise((resolvePromise) => {
  const request = new EventEmitter()
  request.method = method
  const response = makeResponse()
  const originalEnd = response.end.bind(response)
  response.end = (body) => { originalEnd(body); resolvePromise(response) }
  handler(request, response)
  if (method === 'POST') {
    setImmediate(() => {
      request.emit('data', Buffer.from(JSON.stringify(payload)))
      request.emit('end')
    })
  }
})

const json = (response) => {
  try { return JSON.parse(response.body || '{}') } catch { return {} }
}

// ── 会话预算 ──
const arrayBody = await call(routes.sessionBudgetHandler, 'POST', [1, 2])
check('session-budget 拒绝数组 body（400）', arrayBody.statusCode === 400 && json(arrayBody).error === 'expected a JSON object', json(arrayBody).error)
const noId = await call(routes.sessionBudgetHandler, 'POST', { tokens: 1000 })
check('session-budget 缺 sessionId 返回 400', noId.statusCode === 400, json(noId).error)
const negative = await call(routes.sessionBudgetHandler, 'POST', { sessionId: 's1', tokens: -5 })
check('session-budget 非正整数 tokens 返回 400', negative.statusCode === 400, json(negative).error)
const setBudget = await call(routes.sessionBudgetHandler, 'POST', { sessionId: 's1', tokens: 4000 })
const setBody = json(setBudget)
check('session-budget 设置返回 202 并回显', setBudget.statusCode === 202 && setBody.tokens === 4000, setBody)
check('session-budget 设置写进了覆盖表', calls.budgets.get('s1') === 4000, [...calls.budgets])
check('session-budget 设置触发 revision 递增', calls.revisions === 1, calls.revisions)
const clearBudget = await call(routes.sessionBudgetHandler, 'POST', { sessionId: 's1', tokens: null })
check('session-budget 清除返回 202 且 tokens 为 null', clearBudget.statusCode === 202 && json(clearBudget).tokens === null, json(clearBudget))
check('session-budget 清除移除了覆盖', !calls.budgets.has('s1'), [...calls.budgets])
const methodWrong = await call(routes.sessionBudgetHandler, 'GET')
check('session-budget 拒绝 GET（405）', methodWrong.statusCode === 405, methodWrong.statusCode)

// ── 数据清理 ──
const badScope = await call(routes.dataResetHandler, 'POST', { scope: 'everything' })
check('data/reset 非法 scope 返回 400', badScope.statusCode === 400, json(badScope).error)
const logsOnly = await call(routes.dataResetHandler, 'POST', { scope: 'logs' })
check('data/reset {scope:logs} 清日志不清开关', logsOnly.statusCode === 202 && Array.isArray(calls.hydrated) && calls.clearedToggles === 0, { hydrated: calls.hydrated, cleared: calls.clearedToggles })
const togglesOnly = await call(routes.dataResetHandler, 'POST', { scope: 'toggles' })
check('data/reset {scope:toggles} 清开关并落盘', togglesOnly.statusCode === 202 && calls.clearedToggles === 1 && calls.savedToggles === 1, { cleared: calls.clearedToggles, saved: calls.savedToggles })
const everything = await call(routes.dataResetHandler, 'POST', { scope: 'all' })
check('data/reset {scope:all} 两者都做', everything.statusCode === 202 && calls.clearedToggles === 2, calls.clearedToggles)

// ── 会话级提示词文本 ──
const noText = await call(routes.sessionPromptHandler, 'POST', { name: 'persona' })
check('session prompt 缺 text 返回 400', noText.statusCode === 400, json(noText).error)
const latestUsed = await call(routes.sessionPromptHandler, 'POST', { name: 'persona', text: 'hello' })
check('session prompt 缺 sessionId 时回落到最新会话', latestUsed.statusCode === 202 && json(latestUsed).sessionId === 'latest-session', json(latestUsed))
const explicit = await call(routes.sessionPromptHandler, 'POST', { name: 'persona', text: 'hello', sessionId: 'explicit-id' })
check('session prompt 显式 sessionId 优先', explicit.statusCode === 202 && json(explicit).sessionId === 'explicit-id', json(explicit))
check('session prompt 写进了文本表并落盘', calls.promptText.length === 2 && calls.savedToggles >= 3, { text: calls.promptText.length, saved: calls.savedToggles })

const resetNamed = await call(routes.sessionPromptResetHandler, 'POST', { sessionId: 'explicit-id', name: 'persona' })
check('session prompt reset 带 name 只清该 section', resetNamed.statusCode === 202 && calls.clearedText.at(-1)[1] === 'persona', calls.clearedText.at(-1))
const resetAll = await call(routes.sessionPromptResetHandler, 'POST', { sessionId: 'explicit-id' })
check('session prompt reset 不带 name 时 name 为 undefined', resetAll.statusCode === 202 && calls.clearedText.at(-1)[1] === undefined, calls.clearedText.at(-1))

// 无会话可用时两条都要 409
const noSessionRoutes = createSessionRoutes({
  jsonSender, requireMethod, readJson,
  bumpStatusRevision: () => {}, latestSessionId: () => undefined,
  setSessionBudget: () => true, clearSessionBudget: () => {}, listSessionBudgets: () => [],
  hydrateCompactionLog: () => {}, compactionLogPath: '/tmp/x', atomicWriteFile: () => {},
  clearAllSessionToggles: () => 0, saveSessionToggles: () => {},
  setSessionPromptText: () => {}, clearSessionPromptText: () => {},
  getExtraPrompts: () => ({}), getExtraPromptPlacements: () => ({}),
  writeExtraPrompts: (next, place, response, send) => send(202, { ok: true }),
})
const noSessionSave = await call(noSessionRoutes.sessionPromptHandler, 'POST', { name: 'x', text: 'y' })
check('无会话时 session prompt 返回 409', noSessionSave.statusCode === 409, json(noSessionSave).error)
const noSessionReset = await call(noSessionRoutes.sessionPromptResetHandler, 'POST', {})
check('无会话时 session prompt reset 返回 409', noSessionReset.statusCode === 409, json(noSessionReset).error)

// ── 新增提示词 ──
const emptyText = await call(routes.extraPromptHandler, 'POST', { name: 'n', text: '   ' })
check('extra-prompt 空文本返回 400', emptyText.statusCode === 400, json(emptyText).error)
const longName = await call(routes.extraPromptHandler, 'POST', { name: 'x'.repeat(81), text: 'ok' })
check('extra-prompt 名字超长返回 400', longName.statusCode === 400, json(longName).error)
const badPlacement = await call(routes.extraPromptHandler, 'POST', { name: 'n', text: 'ok', placement: 'both' })
check('extra-prompt 非法 placement 返回 400', badPlacement.statusCode === 400, json(badPlacement).error)
const added = await call(routes.extraPromptHandler, 'POST', { name: 'style', text: '简明', placement: 'user' })
check('extra-prompt 新增 user 位置返回 202', added.statusCode === 202 && json(added).placements?.style === 'user', json(added))
const addedSystem = await call(routes.extraPromptHandler, 'POST', { name: 'style', text: '简明', placement: 'system' })
check('extra-prompt 改回 system 会移除 placement 条目', addedSystem.statusCode === 202 && json(addedSystem).placements?.style === undefined, json(addedSystem).placements)
const removed = await call(routes.extraPromptResetHandler, 'POST', { name: 'style' })
check('extra-prompt reset 带 name 只删该条', removed.statusCode === 202 && !('style' in json(removed).accepted), json(removed).accepted)
const removedAll = await call(routes.extraPromptResetHandler, 'POST', {})
check('extra-prompt reset 不带 name 清空', removedAll.statusCode === 202 && Object.keys(json(removedAll).accepted).length === 0, json(removedAll).accepted)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[routes-session] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
