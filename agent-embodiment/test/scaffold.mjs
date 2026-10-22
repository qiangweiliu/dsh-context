/**
 * Agent Embodiment Scaffold 的纯离线测试。
 *
 * 运行：node test/scaffold.mjs
 * 不依赖 DSH 运行时、不写盘；只验证生成物结构、模板稳定性与安全约束。
 */
import { SCAFFOLD_TEMPLATES, emitYamlArray, mergeAgentsContent, planScaffold } from '../scaffold.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fileOf = (plan, suffix) => plan.files.find((file) => file.path.endsWith(suffix))

check('模板数量为 6', SCAFFOLD_TEMPLATES.length === 6, SCAFFOLD_TEMPLATES.map((item) => item.id))
check('模板 id 唯一', new Set(SCAFFOLD_TEMPLATES.map((item) => item.id)).size === SCAFFOLD_TEMPLATES.length)
check('每个模板有 name/description/pattern', SCAFFOLD_TEMPLATES.every((item) => item.name && item.description && item.pattern))

for (const template of SCAFFOLD_TEMPLATES) {
  const slug = `check-${template.id}`
  const plan = planScaffold({ template: template.id, slug, name: `Check ${template.id}` })
  const bundle = `.dsh/scaffolds/${slug}`
  const expected = [
    `${bundle}/package.json`,
    `${bundle}/senses.js`,
    `${bundle}/dsh.bundle.patch.yml`,
    `${bundle}/embodiment.json`,
    `${bundle}/README.md`,
    `${bundle}/SENSES.md`,
    `${bundle}/HANDS.md`,
    `${bundle}/LOOP.md`,
    `${bundle}/AGENTS.snippet.md`,
    `${bundle}/skills/sense-environment/SKILL.md`,
    `${bundle}/skills/verify-change/SKILL.md`,
    `${bundle}/skills/tool-catalog/SKILL.md`,
    `${bundle}/evals/sense-act.jsonl`,
    `${bundle}/evals/run.mjs`,
    `.agents/skills/${slug}-sense-environment/SKILL.md`,
    `.agents/skills/${slug}-verify-change/SKILL.md`,
    `.agents/skills/${slug}-tool-catalog/SKILL.md`,
    ...(template.subagent
      ? [`${bundle}/skills/delegate-${template.subagent.role}/SKILL.md`, `.agents/skills/${slug}-delegate-${template.subagent.role}/SKILL.md`]
      : []),
  ]
  check(`${template.id}: 生成完整文件集`, expected.every((path) => plan.files.some((file) => file.path === path)), plan.files.map((file) => file.path))

  const pkg = JSON.parse(fileOf(plan, '/package.json').content)
  check(`${template.id}: package 是 DSH bundle`, pkg.name === `dsh-embodiment-${slug}` && pkg.dsh?.bundle?.patch === './dsh.bundle.patch.yml', pkg)
  check(`${template.id}: package 导出 senses`, pkg.exports?.['./senses'] === './senses.js', pkg.exports)
  check(`${template.id}: package 不声明 npm 依赖`, !pkg.dependencies && !pkg.devDependencies, pkg.dependencies)

  const senses = fileOf(plan, '/senses.js').content
  check(`${template.id}: senses 插件注册 sense_environment`, senses.includes("name: 'sense_environment'") && senses.includes('ctx.tools.register(tool)') && senses.includes("inject = ['tools']"), senses.slice(0, 200))
  check(`${template.id}: senses 只 import node 内置`, (senses.match(/from '[^']+'/g) ?? []).every((line) => line.includes("'node:")), senses.match(/from '[^']+'/g))

  const patch = fileOf(plan, 'dsh.bundle.patch.yml').content
  check(`${template.id}: patch 顶层是 insert 数组`, patch.startsWith('- insert:\n'), patch.slice(0, 40))
  check(`${template.id}: patch 含 preset 行`, patch.includes(`id: "preset-${slug}"`) && patch.includes('name: "@deepseek-ai/dsh-agent-preset"'), patch.slice(0, 200))
  check(`${template.id}: patch 含 persona`, patch.includes('name: "@deepseek-ai/dsh-persona"'))
  check(`${template.id}: patch 含 sense 工具行`, patch.includes(`name: "dsh-embodiment-${slug}/senses"`), patch.slice(0, 400))
  check(`${template.id}: patch 含上下文控制`, patch.includes('name: "agent-embodiment/control"'))
  check(`${template.id}: patch 含 skill 工具`, patch.includes('@deepseek-ai/dsh-skill-filesystem') && patch.includes('@deepseek-ai/dsh-tool-skill'))
  if (template.tools.some((item) => item.name === '@deepseek-ai/dsh-tool-bash')) {
    check(`${template.id}: patch 含平台 shell 分支`, patch.includes('!!js process.platform === \'win32\'') && patch.includes('!!js process.platform !== \'win32\''))
  }
  if (template.subagent) {
    check(`${template.id}: patch 含隔离子 agent`, patch.includes(`toolName: "delegate_${template.subagent.role}"`) && patch.includes('maxDepth: 1'))
    check(`${template.id}: subagent 不使用已废弃的 persona/toolFilter`, !/toolName: "delegate_[\s\S]*?(persona|toolFilter):/.test(patch), patch.slice(patch.indexOf(`toolName: "delegate_${template.subagent.role}"`), patch.indexOf(`toolName: "delegate_${template.subagent.role}"`) + 300))
  }

  const skills = plan.files.filter((file) => file.path.endsWith('/SKILL.md'))
  check(`${template.id}: 每个 skill 有前端元数据`, skills.every((file) => /^---\nname: [a-z0-9-]+\ndescription: ".+"\n---\n/u.test(file.content)), skills.map((file) => file.path))
  check(`${template.id}: skill 名带 slug 前缀`, skills.every((file) => file.content.includes(`name: ${slug}-`)), skills.map((file) => file.content.split('\n')[1]))

  const evals = fileOf(plan, 'evals/sense-act.jsonl').content.trim().split('\n').map((line) => JSON.parse(line))
  check(`${template.id}: 至少 2 条 eval`, evals.length >= 2 && evals.every((item) => item.id && item.task && item.expect), evals)
  const runner = fileOf(plan, 'evals/run.mjs').content
  check(`${template.id}: eval runner 只依赖 node 内置`, runner.includes('spawnSync') && runner.includes('sense-act.jsonl') && (runner.match(/from '[^']+'/g) ?? []).every((line) => line.includes("'node:")), runner.match(/from '[^']+'/g))

  // 提示词/技能/preset 必须稳定；eval runner 用 Date.now 记耗时，不进入模型上下文。
  const generated = plan.files.filter((file) => !file.path.endsWith('evals/run.mjs')).map((file) => file.content).join('\n')
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

// AGENTS.md 合并：保留用户内容、幂等替换、空文件创建
const agentsPlan = planScaffold({ template: 'repo-coder', slug: 'agents-test' })
const mergedEmpty = mergeAgentsContent('', agentsPlan.agents)
check('AGENTS.md 空文件创建带标记 section', mergedEmpty.includes(agentsPlan.agents.markers.start) && mergedEmpty.includes(agentsPlan.agents.markers.end), mergedEmpty)
const mergedUser = mergeAgentsContent('# My rules\n\n- keep me\n', agentsPlan.agents)
check('AGENTS.md 保留用户内容', mergedUser.includes('# My rules') && mergedUser.includes('- keep me') && mergedUser.includes(agentsPlan.agents.markers.start), mergedUser)
const mergedAgain = mergeAgentsContent(mergedUser, agentsPlan.agents)
check('AGENTS.md 合并幂等', mergedAgain === mergedUser && (mergedAgain.match(new RegExp(agentsPlan.agents.markers.start, 'g')) ?? []).length === 1, mergedAgain)
const changedPlan = planScaffold({ template: 'repo-coder', slug: 'agents-test', name: 'Changed Name' })
const changedAgents = mergeAgentsContent(mergedUser, changedPlan.agents)
check('AGENTS.md 可替换已有标记区间', changedAgents.includes('Changed Name') && (changedAgents.match(new RegExp(agentsPlan.agents.markers.start, 'g')) ?? []).length === 1, changedAgents)

// MCP 生成：stdio + streamable-http，env/header 用 ${VAR} 引用
const mcpPlan = planScaffold({
  template: 'repo-coder',
  slug: 'mcp-test',
  mcp: [
    { serverName: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
    { serverName: 'web', transport: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: '${MCP_TOKEN}' } },
  ],
})
const mcpPatch = fileOf(mcpPlan, 'dsh.bundle.patch.yml').content
check('MCP: stdio 行生成', mcpPatch.includes('name: "@deepseek-ai/dsh-mcp-client"') && mcpPatch.includes('serverName: "github"') && mcpPatch.includes('command: "npx"'), mcpPatch.slice(0, 500))
check('MCP: env 引用不落明文', mcpPatch.includes('!!js process.env.GITHUB_TOKEN') && !/sk-[A-Za-z0-9]{8,}/u.test(mcpPatch), mcpPatch)
check('MCP: streamable-http 行生成', mcpPatch.includes('serverName: "web"') && mcpPatch.includes('url: "https://example.com/mcp"') && mcpPatch.includes('!!js process.env.MCP_TOKEN'), mcpPatch)
for (const [label, mcp] of [
  ['MCP: 重复 serverName 被拒绝', [{ serverName: 'x', transport: 'stdio', command: 'a' }, { serverName: 'x', transport: 'stdio', command: 'b' }]],
  ['MCP: 非法 serverName 被拒绝', [{ serverName: '../x', transport: 'stdio', command: 'a' }]],
  ['MCP: stdio 缺 command 被拒绝', [{ serverName: 'x', transport: 'stdio' }]],
  ['MCP: http 缺 url 被拒绝', [{ serverName: 'x', transport: 'streamable-http' }]],
]) {
  try {
    planScaffold({ template: 'repo-coder', mcp })
    check(label, false, 'did not throw')
  } catch {
    check(label, true)
  }
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[scaffold] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[scaffold] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
