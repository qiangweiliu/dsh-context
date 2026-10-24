#!/usr/bin/env node
/**
 * Tier B 题库：50 题，专门制造“记忆/长上下文”压力。
 *
 * 20 多轮记忆（同一 session 16-18 轮，早期事实在后续被追问）
 * 15 超长单次上下文（60k 字符左右，跨 150-240 条记录聚合）
 * 9 代码实现（8 道来自 v1 + JSON Patch）
 * 6 真实仓库任务（来自 v1）
 *
 * 用法：node eval/deep/v2/make-suite.mjs [--check] [--pilot]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const HERE = import.meta.dirname
const OUT = resolve(ROOT, 'eval/deep/questions-v2.jsonl')
const V1 = resolve(ROOT, 'eval/deep/archive/questions-v1.jsonl')
const CHECK = process.argv.includes('--check')
const PILOT = process.argv.includes('--pilot')

const pad = (value, width = 2) => String(value).padStart(width, '0')
const money = (value) => Math.round(value * 100) / 100

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = 'scope review owner rollout metric queue cache schema budget incident latency region contract supplier audit policy migration flag rollback validation batch window shard replica token session context memory summary trace span alert dashboard release version patch vendor invoice ledger forecast capacity threshold buffer'.split(' ')
function filler(rand, chars, seedLabel) {
  const sentences = []
  let size = 0
  let index = 0
  while (size < chars) {
    const words = []
    const length = 8 + Math.floor(rand() * 12)
    for (let n = 0; n < length; n += 1) words.push(WORDS[Math.floor(rand() * WORDS.length)])
    const sentence = `${words.join(' ')}.`
    sentences.push(sentence)
    size += sentence.length + 1
    index += 1
  }
  return `${seedLabel} (unconfirmed draft notes; not part of the fact ledger):\n${sentences.join(' ')}`
}

const items = []

function add(item) {
  if (items.some((entry) => entry.id === item.id)) throw new Error(`duplicate ${item.id}`)
  items.push(item)
}

// ── A. 多轮记忆（20 题）──────────────────────────────────────────────────

const OWNERS = ['Alice', 'Bob', 'Carol', 'Dana']
const PHASES = ['alpha', 'beta', 'gamma']
const REGIONS = ['East', 'West', 'North', 'South']
const RISKS = ['high', 'medium', 'low']
const DOMAINS = [
  ['cloud migration', 'USD'], ['data platform', 'EUR'], ['support tooling', 'USD'],
  ['payments', 'USD'], ['analytics', 'EUR'], ['identity', 'USD'],
  ['logistics', 'USD'], ['billing', 'EUR'], ['search', 'USD'], ['mobile', 'USD'],
  ['security', 'EUR'], ['infra', 'USD'], ['catalog', 'USD'], ['notifications', 'EUR'],
  ['reporting', 'USD'], ['onboarding', 'USD'], ['exports', 'EUR'], ['experiments', 'USD'],
  ['audit', 'USD'], ['scheduling', 'EUR'],
]

function multiTurn(seed, domain, unit) {
  const rand = mulberry32(1000 + seed)
  const facts = Array.from({ length: 60 }, (_, index) => ({
    id: `F${pad(index + 1)}`,
    owner: OWNERS[Math.floor(rand() * OWNERS.length)],
    phase: PHASES[Math.floor(rand() * PHASES.length)],
    amount: 100 + Math.floor(rand() * 9900),
    region: REGIONS[Math.floor(rand() * REGIONS.length)],
    risk: RISKS[Math.floor(rand() * RISKS.length)],
  }))
  // 保证至少有一个组合有 10 个匹配，避免随机数据把题目变成无解。
  const target = { owner: OWNERS[seed % OWNERS.length], phase: PHASES[seed % PHASES.length], risk: 'high' }
  for (let index = 0; index < 25; index += 1) Object.assign(facts[index], target)
  const combos = []
  for (const owner of OWNERS) for (const phase of PHASES) for (const risk of RISKS) {
    const matched = facts.filter((fact) => fact.owner === owner && fact.phase === phase && fact.risk === risk)
    combos.push({ owner, phase, risk, matched })
  }
  const chosen = combos.filter((combo) => combo.matched.length >= 8).sort((a, b) => b.matched.length - a.matched.length || String(a.owner + a.phase + a.risk).localeCompare(String(b.owner + b.phase + b.risk)))[0] ?? combos.sort((a, b) => b.matched.length - a.matched.length)[0]
  const { owner, phase, risk } = chosen
  const matches = chosen.matched
  // 三条权威更正：改金额、降风险、转移 owner。final 只统计更正后仍匹配的工作流。
  const corrections = [
    { id: matches[0].id, field: 'amount', value: matches[0].amount + 137, label: 'budget correction' },
    { id: matches[1].id, field: 'risk', value: 'medium', label: 'risk downgrade' },
    { id: matches[2].id, field: 'owner', value: 'Bob', label: 'ownership transfer' },
  ]
  const state = new Map(matches.map((fact) => [fact.id, { ...fact }]))
  for (const correction of corrections) state.get(correction.id)[correction.field] = correction.value
  const included = matches.map((fact) => state.get(fact.id)).filter((fact) => fact.owner === owner && fact.phase === phase && fact.risk === risk).sort((a, b) => a.id.localeCompare(b.id))
  const gold = `${included.reduce((sum, fact) => sum + fact.amount, 0)}|${included.map((fact) => fact.id).join(',')}`
  const turns = []
  for (let group = 0; group < 12; group += 1) {
    const batch = facts.slice(group * 5, group * 5 + 5)
    turns.push([
      `Project log ${pad(group + 1)} — ${domain}.`,
      '',
      'The steering group finalized the following workstreams. Each sentence is authoritative:',
      ...batch.map((fact) => `Workstream ${fact.id}, owned by ${fact.owner} in phase ${fact.phase} with risk ${fact.risk}, has a budget of ${fact.amount} ${unit} in ${fact.region}.`),
      '',
      filler(rand, 900 + Math.floor(rand() * 500), `Day ${group + 1}`),
      '',
      'Reply with exactly "noted".',
    ].join('\n'))
  }
  for (const [index, correction] of corrections.entries()) {
    turns.push([
      `Project log ${pad(9 + index)} — ${domain}.`,
      '',
      `Correction (authoritative): the ${correction.label} for ${correction.id} is now ${correction.field}=${correction.value}. This replaces the earlier value for ${correction.id}.`,
      '',
      filler(rand, 2200 + Math.floor(rand() * 600), `Correction ${index + 1}`),
      '',
      'Reply with exactly "noted".',
    ].join('\n'))
  }
  for (let turn = 16; turn < 23; turn += 1) {
    turns.push([
      `Project log ${pad(turn + 1)} — ${domain}.`,
      '',
      filler(rand, 7200 + Math.floor(rand() * 1800), `Day ${turn + 1}`),
      '',
      'Reply with exactly "noted".',
    ].join('\n'))
  }
  turns.push([
    `Using only the workstream facts recorded earlier in this conversation, and applying every later correction, compute the total amount for workstreams with owner=${owner}, phase=${phase}, and risk=${risk}.`,
    'Do not use outside knowledge and do not count the unconfirmed draft notes.',
    'Output the total and the included workstream ids, sorted, in the exact form `答案: <total>|<id1,id2,...>`.',
  ].join('\n'))
  return {
    turns,
    gold,
    question: `multi-turn: ${domain}; owner=${owner} phase=${phase} risk=${risk}`,
    matches: matches.map((fact) => fact.id),
    corrections: corrections.map((correction) => `${correction.id}.${correction.field}=${correction.value}`),
  }
}

for (const [index, [domain, unit]] of DOMAINS.entries()) {
  const built = multiTurn(index + 1, domain, unit)
  add({
    id: `deep-b-memory-${pad(index + 1)}`,
    category: 'multi-turn',
    difficulty: 5,
    title: `Multi-turn memory: ${domain}`,
    prompt: built.turns[built.turns.length - 1],
    turns: built.turns,
    gold: built.gold,
    verify: { type: 'exact' },
    timeoutSec: 900,
    tags: ['memory', 'multi-turn', 'compaction', 'sum-and-ids'],
    notes: `matching facts: ${built.matches.join(',')}; corrections: ${built.corrections.join(', ')}`,
  })
}

// ── B. 超长单次上下文（15 题）────────────────────────────────────────────

const LONG_TEMPLATES = ['invoices', 'logs', 'contracts', 'permissions', 'ledger']
function longContext(seed, template) {
  const rand = mulberry32(2000 + seed)
  const lines = []
  let gold
  let question
  if (template === 'invoices') {
    const suppliers = ['Acme', 'Borealis', 'Cinder', 'Delta', 'Evergreen']
    const rows = Array.from({ length: 220 }, (_, index) => ({
      id: `INV-${pad(index + 1, 4)}`,
      supplier: suppliers[Math.floor(rand() * suppliers.length)],
      region: REGIONS[Math.floor(rand() * REGIONS.length)],
      date: `2026-0${1 + Math.floor(rand() * 6)}-${pad(1 + Math.floor(rand() * 28))}`,
      amount: money(50 + rand() * 4950),
      status: rand() < 0.75 ? 'paid' : 'open',
    }))
    const supplier = suppliers[seed % suppliers.length]
    const region = REGIONS[(seed + 1) % REGIONS.length]
    const total = money(rows.filter((row) => row.supplier === supplier && row.region === region && row.status === 'paid' && row.date >= '2026-03-01' && row.date <= '2026-05-31').reduce((sum, row) => sum + row.amount, 0))
    gold = total
    question = `Sum the amount of invoices with supplier=${supplier}, region=${region}, status=paid, and date between 2026-03-01 and 2026-05-31 inclusive.`
    lines.push('invoice_id,supplier,region,date,amount,status', ...rows.map((row) => `${row.id},${row.supplier},${row.region},${row.date},${row.amount.toFixed(2)},${row.status}`))
  } else if (template === 'logs') {
    const services = ['api', 'web', 'db', 'worker', 'auth']
    const rows = Array.from({ length: 260 }, (_, index) => ({
      ts: `2026-04-${pad(1 + Math.floor(rand() * 28))}T${pad(Math.floor(rand() * 24))}:${pad(Math.floor(rand() * 60))}:00Z`,
      service: services[Math.floor(rand() * services.length)],
      status: [200, 200, 400, 404, 500, 502, 503][Math.floor(rand() * 7)],
      latency: 5 + Math.floor(rand() * 2000),
    }))
    const service = services[seed % services.length]
    const subset = rows.filter((row) => row.service === service && row.status >= 500)
    gold = subset.length
    question = `Count the log records for service=${service} with status >= 500.`
    lines.push('timestamp,service,status,latency_ms', ...rows.map((row) => `${row.ts},${row.service},${row.status},${row.latency}`))
  } else if (template === 'contracts') {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      id: `C-${pad(index + 1, 4)}`,
      owner: OWNERS[Math.floor(rand() * OWNERS.length)],
      start: `2025-${pad(1 + Math.floor(rand() * 12))}-01`,
      end: `2026-${pad(1 + Math.floor(rand() * 12))}-28`,
      value: money(1000 + rand() * 99000),
      renewal: rand() < 0.4,
    }))
    const owner = OWNERS[seed % OWNERS.length]
    gold = money(rows.filter((row) => row.owner === owner && row.renewal && row.end >= '2026-06-01').reduce((sum, row) => sum + row.value, 0))
    question = `Sum the value of contracts owned by ${owner} with renewal=true and end date on or after 2026-06-01.`
    lines.push('contract_id,owner,start,end,value,renewal', ...rows.map((row) => `${row.id},${row.owner},${row.start},${row.end},${row.value.toFixed(2)},${row.renewal}`))
  } else if (template === 'permissions') {
    const rows = Array.from({ length: 220 }, (_, index) => ({
      id: `E-${pad(index + 1, 4)}`,
      user: `user-${pad(1 + Math.floor(rand() * 60))}`,
      action: ['read', 'write', 'delete', 'admin'][Math.floor(rand() * 4)],
      resource: ['repo-a', 'repo-b', 'bucket-x', 'db-y'][Math.floor(rand() * 4)],
      allowed: rand() < 0.7,
    }))
    const action = ['read', 'write', 'delete', 'admin'][seed % 4]
    const resource = ['repo-a', 'repo-b', 'bucket-x', 'db-y'][(seed + 1) % 4]
    const users = [...new Set(rows.filter((row) => row.action === action && row.resource === resource && !row.allowed).map((row) => row.user))].sort()
    gold = users.join(',')
    question = `List every user id (exactly as written, keep the "user-" prefix and do not translate it) with a denied event (allowed=false) for action=${action} on resource=${resource}. Sort user ids and separate with commas.`
    lines.push('event_id,user,action,resource,allowed', ...rows.map((row) => `${row.id},${row.user},${row.action},${row.resource},${row.allowed}`))
  } else {
    const orders = Array.from({ length: 140 }, (_, index) => ({
      id: `O-${pad(index + 1, 4)}`,
      region: REGIONS[Math.floor(rand() * REGIONS.length)],
      date: `2026-04-${pad(1 + Math.floor(rand() * 28))}`,
      amount: money(100 + rand() * 1900),
    }))
    const refunds = Array.from({ length: 70 }, (_, index) => ({
      id: `R-${pad(index + 1, 4)}`,
      order: orders[Math.floor(rand() * orders.length)].id,
      amount: money(10 + rand() * 300),
      date: `2026-04-${pad(1 + Math.floor(rand() * 28))}`,
    }))
    const region = REGIONS[seed % REGIONS.length]
    const selected = new Set(orders.filter((order) => order.region === region && order.date >= '2026-04-10').map((order) => order.id))
    const charges = orders.filter((order) => selected.has(order.id)).reduce((sum, order) => sum + order.amount, 0)
    const refunded = refunds.filter((refund) => selected.has(refund.order) && refund.date >= '2026-04-10').reduce((sum, refund) => sum + refund.amount, 0)
    gold = money(charges - refunded)
    question = `For region=${region}, compute net amount (orders minus refunds) for dates on or after 2026-04-10.`
    lines.push('type,id,order,region,date,amount')
    for (const order of orders) lines.push(`order,${order.id},,${order.region},${order.date},${order.amount.toFixed(2)}`)
    for (const refund of refunds) lines.push(`refund,${refund.id},${refund.order},,${refund.date},${refund.amount.toFixed(2)}`)
  }
  const context = lines.join('\n')
  return {
    prompt: [
      `Read the dataset below (${context.length} chars). Answer only from it.`,
      question,
      'Round amounts to 2 decimals where applicable. End with `答案: <answer>`.',
      '',
      context,
    ].join('\n'),
    gold,
  }
}

for (let index = 0; index < 15; index += 1) {
  const template = LONG_TEMPLATES[index % LONG_TEMPLATES.length]
  const built = longContext(index + 1, template)
  add({
    id: `deep-b-long-${pad(index + 1)}`,
    category: 'long-context',
    difficulty: 5,
    title: `Long context: ${template} #${index + 1}`,
    prompt: built.prompt,
    contextChars: built.prompt.length,
    gold: built.gold,
    verify: typeof built.gold === 'number' ? { type: 'numeric', decimals: 2 } : { type: 'exact' },
    timeoutSec: 900,
    tags: ['long-context', 'aggregation', template],
  })
}

// ── C. 代码与仓库任务（15 题）───────────────────────────────────────────

const NEW_CODE = {
  id: 'deep-b-code-json-patch',
  category: 'code',
  difficulty: 5,
  title: 'JSON Patch (RFC 6902)',
  language: 'js',
  prompt: 'Implement `applyPatch(document, operations)` in src/jsonpatch.mjs for RFC 6902 add/remove/replace/test operations using RFC 6901 JSON Pointers. Operations must be applied in order; a failing test operation must throw and leave the input document unmodified. Support array add (including `-` append), remove, replace, nested objects, and `~0`/`~1` escaping. Do not modify anything under test/. Run `node --test` and report the result.',
  files: { 'src/jsonpatch.mjs': "export function applyPatch(_document, _operations) {\n  throw new Error('not implemented')\n}\n" },
  tests: {
    'test/jsonpatch.test.mjs': String.raw`import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch } from '../src/jsonpatch.mjs'

const base = { a: { b: [1, 2, 3] }, 'x/y': 1, 'm~n': 2 }
test('replace nested value', () => assert.deepEqual(applyPatch(base, [{ op: 'replace', path: '/a/b/1', value: 9 }]).a.b, [1, 9, 3]))
test('add object key', () => assert.equal(applyPatch(base, [{ op: 'add', path: '/a/c', value: 4 }]).a.c, 4))
test('array append with dash', () => assert.deepEqual(applyPatch(base, [{ op: 'add', path: '/a/b/-', value: 4 }]).a.b, [1, 2, 3, 4]))
test('array insert at index', () => assert.deepEqual(applyPatch(base, [{ op: 'add', path: '/a/b/1', value: 8 }]).a.b, [1, 8, 2, 3]))
test('remove array element', () => assert.deepEqual(applyPatch(base, [{ op: 'remove', path: '/a/b/0' }]).a.b, [2, 3]))
test('remove object key', () => assert.equal('x/y' in applyPatch(base, [{ op: 'remove', path: '/x~1y' }]), false))
test('escaped tilde', () => assert.equal(applyPatch(base, [{ op: 'replace', path: '/m~0n', value: 5 }])['m~n'], 5))
test('test passes then replace', () => assert.equal(applyPatch(base, [{ op: 'test', path: '/a/b/0', value: 1 }, { op: 'replace', path: '/a/b/0', value: 7 }]).a.b[0], 7))
test('failed test throws', () => assert.throws(() => applyPatch(base, [{ op: 'test', path: '/a/b/0', value: 2 }])))
test('missing path throws', () => assert.throws(() => applyPatch(base, [{ op: 'replace', path: '/missing', value: 1 }])))
test('remove missing throws', () => assert.throws(() => applyPatch(base, [{ op: 'remove', path: '/a/nope' }])))
test('input is not mutated on failure', () => {
  const source = { a: [1] }
  assert.throws(() => applyPatch(source, [{ op: 'add', path: '/a/-', value: 2 }, { op: 'test', path: '/a/0', value: 9 }]))
  assert.deepEqual(source, { a: [1] })
})
test('non array operations throws', () => assert.throws(() => applyPatch(base, {})))
` },
  verify: { type: 'tests', command: 'node --test' },
  timeoutSec: 900,
  tags: ['code', 'implementation', 'rfc6902'],
}

const v1 = readFileSync(V1, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const v1Code = v1.filter((item) => item.category === 'code')
const v1Agentic = v1.filter((item) => item.category === 'agentic')
for (const item of v1Code) add({ ...item, id: item.id.replace('deep-code-', 'deep-b-code-') })
add(NEW_CODE)
for (const item of v1Agentic) add({ ...item, id: item.id.replace('deep-agent-', 'deep-b-agent-') })

// ── 输出与自检 ───────────────────────────────────────────────────────────

const counts = items.reduce((map, item) => ({ ...map, [item.category]: (map[item.category] || 0) + 1 }), {})
console.log('[deep-b] count', items.length, counts)
if (items.length !== 50) throw new Error(`expected 50, got ${items.length}`)

const NEW_REFERENCE = String.raw`const isIndex = (key) => /^(?:0|[1-9]\d*)$/u.test(key)
function tokensOf(pointer) {
  if (pointer === '') return []
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('invalid pointer')
  return pointer.slice(1).split('/').map((raw) => raw.replace(/~1/gu, '/').replace(/~0/gu, '~'))
}
function parentOf(document, tokens) {
  let parent = document
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(parent)) {
      if (!isIndex(token)) throw new Error('bad index')
      parent = parent[Number(token)]
    } else {
      if (!parent || typeof parent !== 'object' || !Object.prototype.hasOwnProperty.call(parent, token)) throw new Error('missing')
      parent = parent[token]
    }
  }
  return parent
}
function getValue(document, tokens) {
  let value = document
  for (const token of tokens) {
    if (Array.isArray(value)) {
      if (!isIndex(token) || Number(token) >= value.length) throw new Error('bad index')
      value = value[Number(token)]
    } else {
      if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, token)) throw new Error('missing')
      value = value[token]
    }
  }
  return value
}
function clone(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)) }

export function applyPatch(document, operations) {
  if (!Array.isArray(operations)) throw new TypeError('operations must be an array')
  let working = clone(document)
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') throw new Error('bad operation')
    const tokens = tokensOf(operation.path)
    const key = tokens[tokens.length - 1]
    if (operation.op === 'test') {
      if (JSON.stringify(getValue(working, tokens)) !== JSON.stringify(operation.value)) throw new Error('test failed')
      continue
    }
    if (operation.op === 'remove') {
      if (tokens.length === 0) throw new Error('cannot remove root')
      const parent = parentOf(working, tokens)
      if (Array.isArray(parent)) {
        if (!isIndex(key) || Number(key) >= parent.length) throw new Error('bad index')
        parent.splice(Number(key), 1)
      } else {
        if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('missing')
        delete parent[key]
      }
      continue
    }
    if (operation.op === 'add' || operation.op === 'replace') {
      if (tokens.length === 0) { working = clone(operation.value); continue }
      const parent = parentOf(working, tokens)
      if (Array.isArray(parent)) {
        if (key === '-') { parent.push(clone(operation.value)); continue }
        if (!isIndex(key)) throw new Error('bad index')
        const index = Number(key)
        if (operation.op === 'add') { if (index > parent.length) throw new Error('index out of range'); parent.splice(index, 0, clone(operation.value)) }
        else { if (index >= parent.length) throw new Error('index out of range'); parent[index] = clone(operation.value) }
      } else {
        if (!parent || typeof parent !== 'object') throw new Error('bad parent')
        if (operation.op === 'replace' && !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error('missing')
        parent[key] = clone(operation.value)
      }
      continue
    }
    throw new Error('unknown op')
  }
  return working
}
`

function validateNewCode() {
  const dir = resolve(HERE, '.check-jsonpatch')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n')
  for (const [path, content] of Object.entries({ ...NEW_CODE.files, ...NEW_CODE.tests, 'src/jsonpatch.mjs': NEW_REFERENCE })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  try {
    execFileSync('node', ['--test'], { cwd: dir, stdio: 'pipe', timeout: 30000 })
    console.log('[deep-b] jsonpatch reference ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (CHECK) validateNewCode()

if (!CHECK) {
  const picked = PILOT ? items.filter((item) => ['deep-b-memory-01', 'deep-b-memory-02', 'deep-b-long-01', 'deep-b-long-06'].includes(item.id)) : items
  const jsonl = `${picked.map((item) => JSON.stringify(item)).join('\n')}\n`
  const out = PILOT ? resolve('/tmp/deep-b-pilot.jsonl') : OUT
  writeFileSync(out, jsonl)
  if (!PILOT) writeFileSync(resolve(ROOT, 'eval/deep/questions-v2.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, counts, items }, null, 2)}\n`)
  console.log(`[deep-b] wrote ${out} (${jsonl.length} bytes)`)
}
