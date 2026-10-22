/**
 * 生成 Agent Embodiment Pack（DSH preset bundle + 工作区 skills + evals）。
 *
 * 用法：
 *   node scripts/agent-scaffold.mjs --list
 *   node scripts/agent-scaffold.mjs --template repo-coder --out /path/to/workspace
 *   node scripts/agent-scaffold.mjs --template web-researcher --out . --name "My Researcher" --slug my-researcher
 *
 * 默认不覆盖已有文件；--overwrite 才覆盖。写盘前做绝对路径与路径穿越校验。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { SCAFFOLD_TEMPLATES, planScaffold } from '../ctx-mon-and-con/scaffold.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

if (has('list') || args.length === 0) {
  console.log('Available embodiment templates:')
  for (const template of SCAFFOLD_TEMPLATES) {
    console.log(`  ${template.id.padEnd(16)} ${template.name} — ${template.description}`)
  }
  console.log('\nUsage: node scripts/agent-scaffold.mjs --template <id> --out <workspace> [--slug ...] [--name ...] [--overwrite]')
  process.exit(0)
}

const template = flag('template')
const out = flag('out', '.')
if (!template) {
  console.error('agent-scaffold: --template is required (or use --list)')
  process.exit(2)
}
if (!isAbsolute(out)) {
  console.error('agent-scaffold: --out must be an absolute path')
  process.exit(2)
}

let plan
try {
  plan = planScaffold({
    template,
    slug: flag('slug'),
    name: flag('name'),
    description: flag('description'),
  })
} catch (error) {
  console.error(`agent-scaffold: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const root = resolve(out)
if (root === resolve('/')) {
  console.error('agent-scaffold: refusing to write to the filesystem root')
  process.exit(2)
}
const overwrite = has('overwrite')
const destinations = plan.files.map((file) => ({ ...file, destination: resolve(root, file.path) }))
for (const file of destinations) {
  if (!file.destination.startsWith(root + sep)) {
    console.error(`agent-scaffold: path escapes target: ${file.path}`)
    process.exit(2)
  }
  if (existsSync(file.destination) && !overwrite) {
    console.error(`agent-scaffold: refusing to overwrite ${file.destination} (use --overwrite)`)
    process.exit(1)
  }
}

if (has('dry-run')) {
  console.log(JSON.stringify({ template: plan.template, presetId: plan.presetId, bundleDir: plan.bundleDir, files: plan.files.map((file) => file.path), warnings: plan.warnings }, null, 2))
  process.exit(0)
}

for (const file of destinations) {
  mkdirSync(dirname(file.destination), { recursive: true })
  writeFileSync(file.destination, file.content, 'utf8')
}

console.log(`Generated ${plan.template} embodiment in ${root}`)
for (const file of plan.files) console.log(`  ${file.path}`)
console.log('\nWarnings:')
for (const warning of plan.warnings) console.log(`  - ${warning}`)
console.log('\nInstall (same profile as the running DSH):')
console.log(`  dsh plugin --profile <profile> add ${join(root, plan.bundleDir)}`)
