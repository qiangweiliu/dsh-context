/**
 * 模板离线校验：不调用模型，只验证 6 个模板生成的 Embodiment Pack 结构是否完整自洽。
 *
 * 为什么单独一个文件：`test/scaffold.mjs` 覆盖的是生成器本身的细节（YAML、AGENTS 合并、
 * MCP 行），而这里回答的是产品问题——「这个模板现在能不能交给人用」。4 个 experimental
 * 模板从未做任务验证，至少应该保证生成的 bundle 装得上、skill 能被扫描、evals 能跑。
 *
 * 运行：node test/templates.mjs
 */
import { SCAFFOLD_TEMPLATES, getTemplate, planScaffold } from '../scaffold.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const SLUG_BY_ID = {
  'repo-coder': 'mem-coder',
  'web-researcher': 'web-researcher',
  'ops-runbook': 'ops-runbook',
  'browser-operator': 'browser-operator',
  'data-analyst': 'data-analyst',
  'support-router': 'support-router',
}

const plans = SCAFFOLD_TEMPLATES.map((template) => {
  const slug = SLUG_BY_ID[template.id] || template.id
  return { template, slug, plan: planScaffold({ template: template.id, slug, name: template.name }) }
})

// ── 模板元数据 ──
check('6 个模板都在', SCAFFOLD_TEMPLATES.length === 6, SCAFFOLD_TEMPLATES.length)
check('4 个 experimental 标记正确', SCAFFOLD_TEMPLATES.filter((item) => item.experimental).length === 4, SCAFFOLD_TEMPLATES.filter((item) => item.experimental).map((item) => item.id))
check('每个模板都有 id/name/description', SCAFFOLD_TEMPLATES.every((item) => item.id && item.name && typeof item.description === 'string' && item.description.length > 10))
check('getTemplate 能按 id 取回', SCAFFOLD_TEMPLATES.every((item) => getTemplate(item.id)?.id === item.id))

// ── 生成结果 ──
for (const { template, slug, plan } of plans) {
  const prefix = `[${template.id}]`
  check(`${prefix} 生成成功`, plan.ok === true, plan.ok)
  check(`${prefix} presetId 与 slug 一致`, plan.presetId === slug, { presetId: plan.presetId, slug })

  const entries = Array.isArray(plan.files)
    ? plan.files
    : Object.entries(plan.files || {}).map(([path, content]) => ({ path, content }))
  const names = entries.map((entry) => entry.path)
  const has = (suffix) => names.some((name) => name.endsWith(suffix))
  const pick = (suffix) => {
    const found = entries.find((entry) => entry.path.endsWith(suffix))
    return found ? String(found.content) : ''
  }

  // 1) bundle 本体
  check(`${prefix} 有 package.json 与 patch`, has('/package.json') && has('/dsh.bundle.patch.yml'), names.filter((name) => /package\.json|bundle\.patch/u.test(name)))
  const pkgText = pick('/package.json')
  let pkg = null
  try { pkg = JSON.parse(pkgText) } catch { pkg = null }
  check(`${prefix} package.json 是合法 JSON`, pkg !== null)
  check(`${prefix} package.json 名字含 slug`, Boolean(pkg?.name) && String(pkg.name).includes(slug), pkg?.name)
  check(`${prefix} patch 里 insert 的是本 preset`, pick('/dsh.bundle.patch.yml').includes(slug))

  // 2) 文档四件套
  for (const doc of ['/SENSES.md', '/HANDS.md', '/LOOP.md', '/AGENTS.snippet.md']) {
    const text = pick(doc)
    check(`${prefix} ${doc} 非空且无未替换占位`, text.length > 40 && !/\{\{\w+\}\}/u.test(text), text.slice(0, 40))
  }

  // 3) skills：目录名必须是 `<slug>-<skill>`，SKILL.md 带 frontmatter
  const skillFiles = names.filter((name) => name.endsWith('/SKILL.md'))
  check(`${prefix} 至少生成一个 skill`, skillFiles.length >= 1, skillFiles.length)
  check(`${prefix} skill 目录名带 slug 前缀`, skillFiles.every((name) => /\/\.agents\/skills\/[^/]+\/SKILL\.md$/u.test(name) ? name.includes(`/${slug}-`) : true), skillFiles)
  for (const file of skillFiles) {
    const text = pick(file)
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(text)
    const body = frontmatter ? frontmatter[1] : ''
    check(`${prefix} ${file.split('/').slice(-2)[0]} 有 frontmatter name/description`, /^name:\s*\S+/mu.test(body) && /^description:\s*\S+/mu.test(body), body.slice(0, 60))
  }

  // 4) evals：cases.jsonl 每行合法，且 id/task/expect 三件套齐全
  const casesText = pick('/evals/cases.jsonl')
  const caseLines = casesText.split('\n').filter(Boolean)
  check(`${prefix} evals/cases.jsonl 每行是合法 JSON 且带 id/task/expect`, caseLines.length > 0 && caseLines.every((line) => {
    try {
      const parsed = JSON.parse(line)
      return typeof parsed.id === 'string' && typeof parsed.task === 'string' && typeof parsed.expect === 'string'
    } catch {
      return false
    }
  }), caseLines.length)
  check(`${prefix} 有 evals/run.mjs`, has('/evals/run.mjs'))
  check(`${prefix} embodiment.json 可解析`, (() => {
    try { return typeof JSON.parse(pick('/embodiment.json')) === 'object' } catch { return false }
  })())

  // 5) 安装命令可读
  check(`${prefix} 给出安装命令`, typeof plan.installCommand === 'string' && plan.installCommand.includes(slug), plan.installCommand)

  // 6) experimental 模板应显式告知「未验证 / 需要外部依赖」
  const warnings = Array.isArray(plan.warnings) ? plan.warnings.join(' | ') : ''
  if (template.experimental) {
    check(`${prefix} experimental 模板有警示`, warnings.length > 0, warnings.slice(0, 80))
  }
}

// ── 一致性：同一模板两次生成必须完全一致（无时间戳/随机量）──
{
  const a = planScaffold({ template: 'repo-coder', slug: 'mem-coder' })
  const b = planScaffold({ template: 'repo-coder', slug: 'mem-coder' })
  check('同输入两次生成字节一致', JSON.stringify(a.files) === JSON.stringify(b.files) && Array.isArray(a.files))
}

// ── 未知模板要明确失败 ──
{
  // 既有的显式契约：未知模板直接抛错（不是返回 ok:false），错误里列出可选模板。
  let thrown = null
  try { planScaffold({ template: 'no-such-template', slug: 'x' }) } catch (error) { thrown = error }
  check('未知模板抛错并列出可选模板', thrown instanceof Error && /unknown template/u.test(thrown.message) && /repo-coder/u.test(thrown.message), thrown?.message)
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[templates] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
