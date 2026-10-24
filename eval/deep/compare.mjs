#!/usr/bin/env node
/**
 * 汇总四组对照：base / plugin / scaffold / compact。
 *
 *   node eval/deep/compare.mjs
 *   node eval/deep/compare.mjs --markdown > eval/deep/COMPARE.md
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const ROOT = resolve(import.meta.dirname, '..', '..')
const DIR = resolve(ROOT, flag('dir', 'eval/results'))
const MARKDOWN = args.includes('--markdown')
const CONDITIONS = ['base', 'plugin', 'scaffold', 'compact']
const CATEGORIES = ['multi-turn', 'long-context', 'code', 'agentic']

const data = {}
for (const condition of CONDITIONS) {
  const file = resolve(DIR, `deep-b-${condition}.jsonl`)
  if (!existsSync(file)) continue
  data[condition] = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function stats(rows) {
  const graded = rows.filter((row) => row.correct !== null && !row.manual)
  const correct = graded.filter((row) => row.correct).length
  const sum = (key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
  const usage = (key) => rows.reduce((total, row) => total + (Number(row.usage?.[key]) || 0), 0)
  return {
    n: rows.length,
    correct,
    rate: graded.length ? Math.round((correct / graded.length) * 1000) / 10 : null,
    avgSeconds: rows.length ? Math.round((sum('seconds') / rows.length) * 10) / 10 : 0,
    avgInput: rows.length ? Math.round(usage('input') / rows.length) : 0,
    avgOutput: rows.length ? Math.round(usage('output') / rows.length) : 0,
    avgToolCalls: rows.length ? Math.round((sum('toolCalls') / rows.length) * 10) / 10 : 0,
  }
}

const lines = []
const push = (line = '') => lines.push(line)

push('# Tier B 对照结果')
push('')
push(`生成时间：${new Date().toISOString()}`)
push('')
push('| 条件 | 题数 | 正确 | 正确率 | 平均耗时 | 平均 input | 平均 output | 平均工具调用 |')
push('|---|---:|---:|---:|---:|---:|---:|---:|')
for (const condition of CONDITIONS) {
  if (!data[condition]) continue
  const s = stats(data[condition])
  push(`| ${condition} | ${s.n} | ${s.correct} | ${s.rate ?? '—'}% | ${s.avgSeconds}s | ${s.avgInput} | ${s.avgOutput} | ${s.avgToolCalls} |`)
}
push('')
push('## 分类别')
push('')
push('| 类别 | ' + CONDITIONS.filter((c) => data[c]).map((c) => `${c} 正确/题数`).join(' | ') + ' |')
push('|---|' + CONDITIONS.filter((c) => data[c]).map(() => '---:').join('|') + '|')
for (const category of CATEGORIES) {
  const cells = CONDITIONS.filter((c) => data[c]).map((condition) => {
    const rows = data[condition].filter((row) => row.category === category)
    if (rows.length === 0) return '—'
    const s = stats(rows)
    return `${s.correct}/${s.n}`
  })
  push(`| ${category} | ${cells.join(' | ')} |`)
}

// 逐题通过次数：支持同一条件多次 rep 写进同一个 JSONL。
push('')
push('## 逐题通过次数（passes / runs）')
push('')
push('| 题目 | ' + CONDITIONS.filter((c) => data[c]).map((c) => c).join(' | ') + ' |')
push('|---|' + CONDITIONS.filter((c) => data[c]).map(() => '---:').join('|') + '|')
const allIds = [...new Set(CONDITIONS.flatMap((condition) => (data[condition] || []).map((row) => row.id)))].sort()
for (const id of allIds) {
  const cells = CONDITIONS.filter((c) => data[c]).map((condition) => {
    const rows = data[condition].filter((row) => row.id === id)
    if (rows.length === 0) return '—'
    const passes = rows.filter((row) => row.correct === true).length
    return `${passes}/${rows.length}`
  })
  push(`| ${id} | ${cells.join(' | ')} |`)
}

// 工具与 skill 归因（按出现次数）。
push('')
push('## 工具 / skill 使用')
push('')
for (const condition of CONDITIONS) {
  if (!data[condition]) continue
  const tools = {}
  const skills = {}
  for (const row of data[condition]) {
    for (const name of row.toolNames || []) tools[name] = (tools[name] || 0) + 1
    for (const name of row.skillNames || []) skills[name] = (skills[name] || 0) + 1
  }
  const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([name, count]) => `${name}×${count}`).join(', ') || '—'
  push(`- **${condition}** tools: ${top(tools)}`)
  push(`  skills: ${top(skills)}`)
}

const variants = CONDITIONS.filter((condition) => condition !== 'base' && data[condition] && data.base)
for (const variant of variants) {
  const base = new Map(data.base.map((row) => [row.id, row]))
  const rows = data[variant]
  const changed = rows.filter((row) => {
    const original = base.get(row.id)
    return original && original.correct !== row.correct
  })
  push('')
  push(`## ${variant} vs base：正确性变化`)
  push('')
  if (changed.length === 0) push('无变化。')
  else {
    push('| 题目 | base | ' + variant + ' | 说明 |')
    push('|---|---:|---:|---|')
    for (const row of changed) {
      const original = base.get(row.id)
      push(`| ${row.id} | ${original.correct ? '✓' : '✗'} | ${row.correct ? '✓' : '✗'} | ${String(row.detail || '').slice(0, 80)} |`)
    }
  }
  const baseFail = rows.filter((row) => row.correct === false).map((row) => row.id)
  push('')
  push(`${variant} 失败题：${baseFail.length ? baseFail.join(', ') : '无'}`)
}

const output = `${lines.join('\n')}\n`
process.stdout.write(output)
if (MARKDOWN) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(resolve(ROOT, 'eval/deep/COMPARE.md'), output)
}
