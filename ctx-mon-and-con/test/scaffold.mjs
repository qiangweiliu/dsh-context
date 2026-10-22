/**
 * Agent Embodiment Scaffold 的纯离线测试。
 *
 * 运行：node test/scaffold.mjs
 * 不依赖 DSH 运行时、不写盘；只验证生成物结构、模板稳定性与安全约束。
 */
import { SCAFFOLD_TEMPLATES, emitYamlArray, planScaffold } from '../scaffold.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fileOf = (plan, suffix) => plan.files.find((file) => file.path.endsWith(suffix))

check('模板数量为 3', SCAFFOLD_TEMPLATES.length === 3, SCAFFOLD_TEMPLATES.map((item) => item.id))
check('模板 id 唯一', new Set(SCAFFOLD_TEMPLATES.map((item) => item.id)).size === SCAFFOLD_TEMPLATES.length)
check('每个模板有 name/description/pattern', SCAFFOLD_TEMPLATES.every((item) => item.name && item.description && item.pattern))

for (const template of SCAFFOLD_TEMPLATES) {
  const slug = `check-${template.id}`
  const plan = planScaffold({ template: template.id, slug, name: `Check ${template.id}` })
  const bundle = `.dsh/scaffolds/${slug}`
  const expected = [
    `${bundle}/package.json`,
    `${bundle}/dsh.bundle.patch.yml`,
    `${bundle}/embodiment.json`,
    `${bundle}/README.md`,
    `${bundle}/SENSES.md`,
    `${bundle}/HANDS.md`,
    `${bundle}/LOOP.md`,
    `${bundle}/AGENTS.snippet.md`,
    `${bundle}/skills/sense-environment/SKILL.md`,
    `${bundle}/skills/verify-change/SKILL.md`,
    `${bundle}/evals/sense-act.jsonl`,
    `.agents/skills/${slug}-sense-environment/SKILL.md`,
    `.agents/skills/${slug}-verify-change/SKILL.md`,
  ]
  check(`${template.id}: 生成完整文件集`, expected.every((path) => plan.files.some((file) => file.path === path)), plan.files.map((file) => file.path))

  const pkg = JSON.parse(fileOf(plan, '/package.json').content)
  check(`${template.id}: package 是 DSH bundle`, pkg.name === `dsh-embodiment-${slug}` && pkg.dsh?.bundle?.patch === './dsh.bundle.patch.yml', pkg)
  check(`${template.id}: package 不声明 npm 依赖`, !pkg.dependencies && !pkg.devDependencies, pkg.dependencies)

  const patch = fileOf(plan, 'dsh.bundle.patch.yml').content
  check(`${template.id}: patch 顶层是 insert 数组`, patch.startsWith('- insert:\n'), patch.slice(0, 40))
  check(`${template.id}: patch 含 preset 行`, patch.includes(`id: "preset-${slug}"`) && patch.includes('name: "@deepseek-ai/dsh-agent-preset"'), patch.slice(0, 200))
  check(`${template.id}: patch 含 persona`, patch.includes('name: "@deepseek-ai/dsh-persona"'))
  check(`${template.id}: patch 含上下文控制`, patch.includes('name: "ctx-mon-and-con/control"'))
  check(`${template.id}: patch 含 skill 工具`, patch.includes('@deepseek-ai/dsh-skill-filesystem') && patch.includes('@deepseek-ai/dsh-tool-skill'))
  if (template.tools.some((item) => item.name === '@deepseek-ai/dsh-tool-bash')) {
    check(`${template.id}: patch 含平台 shell 分支`, patch.includes('!!js process.platform === \'win32\'') && patch.includes('!!js process.platform !== \'win32\''))
  }
  if (template.subagent) check(`${template.id}: patch 含隔离子 agent`, patch.includes(`toolName: "delegate_${template.subagent.role}"`) && patch.includes('maxDepth: 1'))

  const skills = plan.files.filter((file) => file.path.endsWith('/SKILL.md'))
  check(`${template.id}: 每个 skill 有前端元数据`, skills.every((file) => /^---\nname: [a-z0-9-]+\ndescription: ".+"\n---\n/u.test(file.content)), skills.map((file) => file.path))
  check(`${template.id}: skill 名带 slug 前缀`, skills.every((file) => file.content.includes(`name: ${slug}-`)), skills.map((file) => file.content.split('\n')[1]))

  const evals = fileOf(plan, 'evals/sense-act.jsonl').content.trim().split('\n').map((line) => JSON.parse(line))
  check(`${template.id}: 至少 2 条 eval`, evals.length >= 2 && evals.every((item) => item.id && item.task && item.expect), evals)

  const generated = plan.files.map((file) => file.content).join('\n')
  check(`${template.id}: 不含时间戳/随机量`, !/\d{4}-\d{2}-\d{2}T/u.test(generated) && !generated.includes('Date.now') && !generated.includes('Math.random'))
  check(`${template.id}: 不含明文 secret`, !/sk-[A-Za-z0-9]{8,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|password\s*[:=]\s*["'][^"']+/u.test(generated))
  check(`${template.id}: 所有文件路径相对且无穿越`, plan.files.every((file) => !file.path.startsWith('/') && !file.path.split('/').includes('..')), plan.files.map((file) => file.path))
  check(`${template.id}: 安装命令指向 bundle`, plan.installCommand.includes(`.dsh/scaffolds/${slug}`), plan.installCommand)
}

// 自定义名称/slug
const custom = planScaffold({ template: 'repo-coder', slug: 'my-coder', name: 'My Coder', description: 'Custom description' })
check('自定义 slug/name/description 生效', custom.presetId === 'my-coder' && custom.spec.name === 'My Coder' && custom.spec.description === 'Custom description', custom.spec)

// 非法输入
for (const [label, input] of [
  ['未知模板', { template: 'nope' }],
  ['空输入', null],
  ['非法 slug', { template: 'repo-coder', slug: '../escape' }],
  ['大写 slug 被规范化后可用', { template: 'repo-coder', slug: 'MY-AGENT' }],
]) {
  try {
    const plan = planScaffold(input)
    check(label, label === '大写 slug 被规范化后可用' && plan.presetId === 'my-agent', plan.presetId)
  } catch (error) {
    check(label, label !== '大写 slug 被规范化后可用', error instanceof Error ? error.message : String(error))
  }
}

// YAML emitter 的最小结构检查
const yaml = emitYamlArray([{ insert: [{ id: 'x', name: 'n', config: { plugins: [{ id: 'a', name: 'b' }] } }] }])
check('YAML emitter 生成嵌套 insert', yaml.includes('- insert:') && yaml.includes('    - id: "x"') && yaml.includes('          - id: "a"'), yaml)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[scaffold] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[scaffold] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
