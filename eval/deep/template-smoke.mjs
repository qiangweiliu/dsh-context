#!/usr/bin/env node
/**
 * 模板冒烟：为指定脚手架模板生成 bundle，再用固定 3 题跑一遍，回答「这个模板能不能用」。
 *
 *   node eval/deep/template-smoke.mjs --dry-run
 *   node eval/deep/template-smoke.mjs --templates ops-runbook,data-analyst
 *   node eval/deep/template-smoke.mjs --ids deep-b-memory-01,deep-b-code-csv --workers 1
 *
 * 与 `run.mjs` 的区别：run.mjs 比较「装不装插件 / 用不用脚手架」；这里比较的是
 * **不同模板**（同一套 3 题），用于给 experimental 模板一个最低限度的可用性信号。
 * 依赖 `setup-conditions.mjs` 已准备 `/tmp/dsh-memory-plugin`。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const ROOT = resolve(import.meta.dirname, '..', '..')
const TEMPLATES = flag('templates', 'ops-runbook,browser-operator,data-analyst,support-router').split(',').map((value) => value.trim()).filter(Boolean)
const IDS = flag('ids', 'deep-b-memory-01,deep-b-long-01,deep-b-code-csv')
const OUT_DIR = resolve(flag('out', 'eval/results/template-smoke'))
const SCAFFOLD_ROOT = resolve(flag('scaffold-root', '/tmp/deep-templates'))
const WORKERS = flag('workers', '1')
const TIMEOUT = flag('timeout', '480')
const DRY = has('dry-run')

console.log(`[template-smoke] templates=${TEMPLATES.join(',')} ids=${IDS} out=${OUT_DIR}`)
if (DRY) {
  for (const template of TEMPLATES) {
    console.log(`  dry: node scripts/agent-scaffold.mjs --template ${template} --out ${join(SCAFFOLD_ROOT, template)} --slug ${template}`)
    console.log(`  dry: node eval/deep/run.mjs --condition scaffold --scaffold-home ${join(SCAFFOLD_ROOT, template)} --ids ${IDS} --workers ${WORKERS} --out ${join(OUT_DIR, `${template}.jsonl`)}`)
  }
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
const summary = []

for (const template of TEMPLATES) {
  const scaffoldHome = join(SCAFFOLD_ROOT, template)
  const outFile = join(OUT_DIR, `${template}.jsonl`)
  const record = { template, scaffoldHome, out: outFile, ok: false, error: null, rows: [] }
  try {
    rmSync(scaffoldHome, { recursive: true, force: true })
    rmSync(outFile, { force: true })
    mkdirSync(scaffoldHome, { recursive: true })
    execFileSync('node', [
      join(ROOT, 'scripts', 'agent-scaffold.mjs'),
      '--template', template,
      '--out', scaffoldHome,
      '--slug', template,
    ], { stdio: 'inherit', cwd: ROOT })

    const skillsDir = join(scaffoldHome, '.agents', 'skills')
    if (!existsSync(skillsDir)) throw new Error(`脚手架没有生成 skills 目录: ${skillsDir}`)

    execFileSync('node', [
      join(ROOT, 'eval', 'deep', 'run.mjs'),
      '--condition', 'scaffold',
      '--scaffold-home', scaffoldHome,
      '--ids', IDS,
      '--workers', WORKERS,
      '--timeout', TIMEOUT,
      '--out', outFile,
    ], { stdio: 'inherit', cwd: ROOT })

    if (existsSync(outFile)) {
      record.rows = readFileSync(outFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line) } catch { return null }
        })
        .filter(Boolean)
    }
    record.ok = record.rows.length > 0
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error)
    console.error(`[template-smoke] ${template} 失败: ${record.error}`)
  }
  summary.push(record)
}

const lines = ['| 模板 | 题数 | 正确 | 状态分布 | 平均 toolCalls | 平均秒 | 错误 |', '| --- | ---: | ---: | --- | ---: | ---: | --- |']
const payload = []
for (const record of summary) {
  const rows = record.rows
  const correct = rows.filter((row) => row.correct === true).length
  const statuses = rows.reduce((map, row) => ({ ...map, [row.status]: (map[row.status] || 0) + 1 }), {})
  const avg = (pick) => (rows.length ? (rows.reduce((sum, row) => sum + (Number(pick(row)) || 0), 0) / rows.length).toFixed(1) : '—')
  lines.push(`| ${record.template} | ${rows.length} | ${correct} | ${Object.entries(statuses).map(([key, value]) => `${key}×${value}`).join(' ') || '—'} | ${avg((row) => row.toolCalls)} | ${avg((row) => row.seconds)} | ${record.error ? record.error.slice(0, 60) : '—'} |`)
  payload.push({
    template: record.template,
    questions: rows.length,
    correct,
    statuses,
    avgToolCalls: Number(avg((row) => row.toolCalls)) || 0,
    avgSeconds: Number(avg((row) => row.seconds)) || 0,
    error: record.error,
    perQuestion: rows.map((row) => ({ id: row.id, status: row.status, correct: row.correct, toolCalls: row.toolCalls, seconds: row.seconds })),
  })
}

const table = lines.join('\n')
writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(join(OUT_DIR, 'SUMMARY.md'), `# 模板冒烟（${new Date().toISOString()}）\n\n${table}\n`)
console.log(`\n${table}\n`)
console.log(`[template-smoke] 汇总写入 ${join(OUT_DIR, 'SUMMARY.md')}`)
