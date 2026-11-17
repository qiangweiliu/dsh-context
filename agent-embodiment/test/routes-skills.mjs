/**
 * `routes-skills.js` 的直接单测（假 request/response + 假 skills 注册表）。
 *
 * 覆盖点都是「真出错时才会发现」的地方：注册表缺席（503）、provider 抛错（500）、
 * 技能名非法（400）、找不到（404）、正文截断、cwd 解析优先级、超时不无限挂住。
 */
import { createSkillRoutes, parseSkillFile, planSkillRoots, scanSkillRoots } from '../routes-skills.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const makeResponse = () => ({ statusCode: 0, body: null })
const makeSender = (response) => (status, body) => {
  response.statusCode = status
  response.body = body
}
const makeRequest = (url) => ({ url, method: 'GET', headers: {} })

/** 路由里 `requireMethod` 的语义：GET 通过，其它写 405 并返回 false。 */
const requireMethod = (request, response, method) => {
  if (request.method === method) return true
  response.statusCode = 405
  response.body = { ok: false, error: `method not allowed: ${request.method}` }
  return false
}

const okRegistry = {
  snapshot: async () => ({
    complete: true,
    skills: [
      { name: 'alpha-skill', description: 'first', source: 'project-agents', provider: 'filesystem', path: '/w/.agents/skills/alpha-skill/SKILL.md', invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'beta-skill', description: 'second', source: 'user-dsh', provider: 'filesystem', path: '/h/.dsh/skills/beta-skill/SKILL.md', invocation: { modelInvocable: false, userInvocable: true }, whenToUse: 'when beta' },
    ],
  }),
  get: async (name) => (name === 'alpha-skill'
    ? { name, description: 'first', source: 'project-agents', provider: 'filesystem', path: '/w/.agents/skills/alpha-skill/SKILL.md', invocation: { modelInvocable: true, userInvocable: true }, content: '# Alpha\nbody' }
    : undefined),
}

const run = async (handler, request) => {
  const response = makeResponse()
  const send = makeSender(response)
  await handler(request, response, send)
  return response
}

const build = (overrides = {}) => createSkillRoutes({
  jsonSender: makeSender,
  requireMethod,
  requestUrl: (request) => new URL(request.url, 'http://127.0.0.1'),
  getSkills: () => okRegistry,
  getCwdForSession: () => '/w',
  defaultCwd: () => '/fallback',
  ...overrides,
})

// ── 列表 ──
{
  const routes = build()
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('列表返回 200', response.statusCode === 200, response.statusCode)
  check('列表带 counts 与 complete', response.body?.complete === true && response.body?.counts?.total === 2, response.body?.counts)
  check('列表按 invocation 计数', response.body?.counts?.model === 1 && response.body?.counts?.user === 2, response.body?.counts)
  check('列表把 invocation 摊平成布尔', response.body?.skills?.[0]?.modelInvocable === true && response.body?.skills?.[1]?.modelInvocable === false)
  check('列表保留 source/provider/path', response.body?.skills?.[0]?.source === 'project-agents' && response.body?.skills?.[0]?.provider === 'filesystem' && response.body?.skills?.[0]?.path?.endsWith('SKILL.md'))
  check('缺省 cwd 来自 defaultCwd', response.body?.cwd === '/fallback' && response.body?.cwdSource === 'process', { cwd: response.body?.cwd, source: response.body?.cwdSource })
}

// ── cwd 解析优先级：sessionId 优先于默认目录 ──
{
  const seen = []
  const routes = build({
    getSkills: () => ({ ...okRegistry, snapshot: async (_options) => { seen.push(_options); return okRegistry.snapshot() } }),
    getCwdForSession: (id) => (id === 's1' ? '/from-session' : null),
  })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills?sessionId=s1'))
  check('sessionId 解析出 cwd', response.body?.cwd === '/from-session' && response.body?.cwdSource === 'session', response.body?.cwd)
  check('cwd 传给注册表', seen[0]?.cwd === '/from-session', seen[0])

  const unknown = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills?sessionId=nope'))
  check('未知会话回落到默认目录', unknown.body?.cwd === '/fallback' && unknown.body?.cwdSource === 'process', unknown.body?.cwd)
}

// ── 不接受任意 ?cwd=（防枚举任意目录）──
{
  const seen = []
  const routes = build({ getSkills: () => ({ ...okRegistry, snapshot: async (_options) => { seen.push(_options); return okRegistry.snapshot() } }) })
  await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills?cwd=/etc'))
  check('忽略请求里的 ?cwd=', seen[0]?.cwd === '/fallback', seen[0])
}

// ── 注册表缺席 → 仍然返回标准根目录的扫盘结果（via=filesystem）──
{
  const routes = build({
    getSkills: () => null,
    resolveHomes: () => ({ dshHome: '/fake/dsh', agentsHome: '/fake/agents' }),
    scanRoots: (roots) => [{
      name: 'scanned-skill',
      description: 'from disk',
      whenToUse: null,
      source: roots[0] ? roots[0].source : null,
      provider: 'filesystem',
      path: '/fake/path/SKILL.md',
      modelInvocable: true,
      userInvocable: true,
    }],
  })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('注册表缺席仍返回 200', response.statusCode === 200, response.statusCode)
  check('注册表缺席标注 via=filesystem', response.body?.via === 'filesystem', response.body?.via)
  check('扫盘结果进入了列表', response.body?.counts?.total === 1 && response.body?.skills?.[0]?.name === 'scanned-skill', response.body?.counts)
}

// ── 注册表在但全局层为空 → 也走扫盘（preset 作用域的真实情况）──
{
  const routes = build({
    getSkills: () => ({ snapshot: async () => ({ skills: [], complete: true }) }),
    resolveHomes: () => ({ dshHome: '/fake/dsh', agentsHome: '/fake/agents' }),
    scanRoots: () => [{
      name: 'z-skill',
      description: 'd',
      whenToUse: null,
      source: 'user-agents',
      provider: 'filesystem',
      path: '/fake/z/SKILL.md',
      modelInvocable: true,
      userInvocable: false,
    }],
  })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('全局层空时走扫盘', response.body?.via === 'filesystem' && response.body?.counts?.total === 1, response.body?.via)
  check('扫盘结果的 invocation 保留', response.body?.skills?.[0]?.userInvocable === false)
}

// ── 注册表有数据时优先用注册表（权威），不浪费一次扫盘 ──
{
  let scanned = false
  const routes = build({ scanRoots: () => { scanned = true; return [] } })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('注册表有数据时 via=registry', response.body?.via === 'registry', response.body?.via)
  check('注册表有数据时不扫盘', scanned === false)
}

// ── 正文：注册表缺席时真的读文件（临时目录，跨平台路径）──
{
  const dir = mkdtempSync(join(tmpdir(), 'embody-skill-'))
  const filePath = join(dir, 'SKILL.md')
  writeFileSync(filePath, '---\nname: disk-skill\ndescription: from disk\n---\n# Disk\nDisk body line\n', 'utf8')
  try {
    const routes = build({
      getSkills: () => null,
      resolveHomes: () => ({}),
      scanRoots: () => [{
        name: 'disk-skill',
        description: 'from disk',
        whenToUse: null,
        source: 'user-dsh',
        provider: 'filesystem',
        path: filePath,
        modelInvocable: true,
        userInvocable: true,
      }],
    })
    const response = await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=disk-skill'))
    check('扫盘路径能取到正文', response.statusCode === 200 && /Disk body line/u.test(String(response.body?.content)), response.body?.content)
    check('正文去掉 frontmatter', !String(response.body?.content || '').includes('name: disk-skill'), String(response.body?.content).slice(0, 30))
    check('正文标注 via=filesystem', response.body?.via === 'filesystem', response.body?.via)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 两条路径都找不到 → 404 ──
{
  const routes = build({ getSkills: () => null, resolveHomes: () => ({}), scanRoots: () => [] })
  const response = await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=ghost-x'))
  check('两条路径都找不到返回 404', response.statusCode === 404, response.statusCode)
}

// ── 纯函数：frontmatter 解析 ──
{
  const parsed = parseSkillFile('---\nname: my-skill\ndescription: does things\nwhenToUse: when needed\n---\n\n# Body\ntext', 'fallback')
  check('解析出 name/description/whenToUse', parsed?.name === 'my-skill' && parsed?.description === 'does things' && parsed?.whenToUse === 'when needed', parsed)
  check('正文不含 frontmatter', parsed?.body === '# Body\ntext', JSON.stringify(parsed?.body))
  check('缺省允许两个面', parsed?.modelInvocable === true && parsed?.userInvocable === true)

  const hidden = parseSkillFile('---\nname: x-skill\ndescription: d\ndisable-model-invocation: yes\nuser-invocable: off\n---\nbody', 'x')
  check('disable-model-invocation 生效', hidden?.modelInvocable === false, hidden?.modelInvocable)
  check('user-invocable 生效', hidden?.userInvocable === false, hidden?.userInvocable)

  check('无 frontmatter 视为无效', parseSkillFile('# just markdown', 'x') === null)
  check('缺 description 视为无效', parseSkillFile('---\nname: a-b\n---\nbody', 'a-b') === null)
  check('非法 name 视为无效', parseSkillFile('---\nname: Bad_Name\ndescription: d\n---\nb', 'Bad_Name') === null)
  check('缺 name 时用目录名兜底', parseSkillFile('---\ndescription: d\n---\nb', 'dir-name')?.name === 'dir-name')
  check('引号包裹的值会去掉引号', parseSkillFile('---\nname: quoted-skill\ndescription: "quoted desc"\n---\nb', 'x')?.description === 'quoted desc')
}

// ── 作用域：拿到 key 就传给注册表，拿不到就不传 ──
{
  const seen = []
  const fakeScope = { id: 'scope' }
  const routes = build({
    getScopeKey: () => fakeScope,
    getSkills: () => ({ ...okRegistry, snapshot: async (options) => { seen.push(options); return okRegistry.snapshot() } }),
  })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('有 scope 时传给注册表', seen[0]?.scope === fakeScope, seen[0]?.scope ? 'present' : 'absent')
  check('有 scope 时响应标注 scopeApplied', response.body?.scopeApplied === true, response.body?.scopeApplied)
}

{
  const seen = []
  const routes = build({
    getScopeKey: () => undefined,
    getSkills: () => ({ ...okRegistry, snapshot: async (options) => { seen.push(options); return okRegistry.snapshot() } }),
  })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('无 scope 时不传该字段', seen[0]?.scope === undefined, Object.keys(seen[0] ?? {}).join(','))
  check('无 scope 时 scopeApplied=false', response.body?.scopeApplied === false, response.body?.scopeApplied)
}

{
  const seen = []
  const routes = build({
    getScopeKey: () => ({ id: 'scope' }),
    getSkills: () => ({ get: async (name, options) => { seen.push(options); return { name, description: '', content: 'x', invocation: { modelInvocable: true, userInvocable: true } } } }),
  })
  await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=alpha-skill'))
  check('正文请求也带 scope', seen[0]?.scope !== undefined, Object.keys(seen[0] ?? {}).join(','))
  check('正文响应也标注 scopeApplied', (await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=alpha-skill'))).body?.scopeApplied === true, 'missing')
}

// ── 纯函数：根目录规划（rank 顺序）──
{
  const roots = planSkillRoots({ cwd: '/w', dshHome: '/h', agentsHome: '/a' })
  check('四个标准根都在', roots.length === 4, roots.map((root) => root.source).join(','))
  check('按 rank 升序', roots.every((root, index) => index === 0 || roots[index - 1].rank < root.rank), roots.map((root) => root.rank).join(','))
  check('优先 project 根', roots[0].source === 'project-dsh' && roots[1].source === 'project-agents', roots.map((root) => root.source).join(','))
  check('缺 cwd 时不列 project 根', planSkillRoots({ dshHome: '/h' }).every((root) => !root.source.startsWith('project')))
  check('缺全部 home 时返回空', planSkillRoots({}).length === 0)
}

// ── 纯函数：扫盘去重、跳过隐藏项、扁平文件 ──
{
  const rootsPlanned = planSkillRoots({ cwd: '/w', dshHome: '/h', agentsHome: '/a' })
  const dupEntry = { name: 'dup-skill', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }
  const bySource = {
    'project-dsh': [],
    'project-agents': [dupEntry, { name: '.system', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }],
    'user-dsh': [dupEntry],
    'user-agents': [{ name: 'flat-skill.md', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }],
  }
  const io = {
    // 按 root 对象匹配而不是按路径后缀：Windows 的 join() 产出反斜杠，后缀匹配会失效
    listDir: (dir) => {
      const root = rootsPlanned.find((candidate) => candidate.dir === dir)
      return root ? (bySource[root.source] ?? []) : []
    },
    readFile: (path) => `---\ndescription: body of ${path}\n---\ncontent`,
  }
  const rows = scanSkillRoots(rootsPlanned, io)
  check('同名技能先到先得（rank 小的赢）', rows.filter((row) => row.name === 'dup-skill').length === 1, rows.map((row) => row.name).join(','))
  check('赢家来自 project-agents', rows.find((row) => row.name === 'dup-skill')?.source === 'project-agents', rows.find((row) => row.name === 'dup-skill')?.source)
  check('跳过 .system 等隐藏项', !rows.some((row) => row.name.startsWith('.')), rows.map((row) => row.name).join(','))
  check('支持扁平 <name>.md', rows.some((row) => row.name === 'flat-skill'), rows.map((row) => row.name).join(','))
  check('结果按 name 排序', rows.map((row) => row.name).join(',') === rows.map((row) => row.name).sort().join(','))
}

// ── 根目录不可读时跳过，不抛错 ──
{
  const rows = scanSkillRoots(planSkillRoots({ cwd: '/w', dshHome: '/h', agentsHome: '/a' }), {
    listDir: () => { throw new Error('EACCES') },
    readFile: () => '',
  })
  check('根目录不可读时返回空而不抛错', Array.isArray(rows) && rows.length === 0)
}

// ── 符号链接：指向目录的要跟进，悬空链接要跳过 ──
{
  const rootsPlanned = planSkillRoots({ dshHome: '/h' })
  const io = {
    listDir: () => [
      { name: 'linked-dir', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
      { name: 'dangling', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
      { name: 'linked-flat.md', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
    ],
    statFile: (path) => {
      if (path.includes('dangling')) throw new Error('ENOENT')
      if (path.includes('linked-dir')) return { isDirectory: () => true, isFile: () => false }
      return { isDirectory: () => false, isFile: () => true }
    },
    readFile: () => '---\ndescription: via link\n---\nbody',
  }
  const rows = scanSkillRoots(rootsPlanned, io)
  check('符号链接指向目录时能发现技能', rows.some((row) => row.name === 'linked-dir'), rows.map((row) => row.name).join(','))
  check('悬空符号链接被跳过', !rows.some((row) => row.name === 'dangling'), rows.map((row) => row.name).join(','))
  check('符号链接指向扁平 md 也能发现', rows.some((row) => row.name === 'linked-flat'), rows.map((row) => row.name).join(','))
}

// ── provider 抛错 → 500，不泄漏堆栈 ──
{
  const routes = build({ getSkills: () => ({ snapshot: async () => { throw new Error('boom') } }) })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('provider 抛错返回 500', response.statusCode === 500, response.statusCode)
  check('500 只带 message', response.body?.error === 'boom' && response.body?.stack === undefined, response.body?.error)
}

// ── incomplete 快照要如实透出 ──
{
  const routes = build({ getSkills: () => ({ snapshot: async () => ({ skills: [], complete: false }) }) })
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  check('complete=false 透传给面板', response.body?.complete === false)
}

// ── 方法限制 ──
{
  const routes = build()
  const response = makeResponse()
  routes.skillsHandler({ ...makeRequest('/api/agent-embodiment/status/skills'), method: 'POST' }, response, makeSender(response))
  check('POST 被 405 拒绝', response.statusCode === 405, response.statusCode)
}

// ── 正文 ──
{
  const routes = build()
  const response = await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=alpha-skill'))
  check('正文返回 200 + content', response.statusCode === 200 && response.body?.content === '# Alpha\nbody', response.body?.content)
  check('正文带 path 与 invocation', response.body?.path?.endsWith('SKILL.md') && response.body?.modelInvocable === true)
  check('正文未截断标记为 false', response.body?.truncated === false)
}

{
  const routes = build()
  const response = await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=ghost-skill'))
  check('未知技能返回 404', response.statusCode === 404, response.statusCode)
}

for (const bad of ['Alpha', 'alpha_skill', '../etc/passwd', '', 'a b']) {
  const routes = build()
  const response = await run(routes.skillBodyHandler, makeRequest(`/api/agent-embodiment/status/skills/body?name=${encodeURIComponent(bad)}`))
  check(`非法技能名被拒：${JSON.stringify(bad)}`, response.statusCode === 400, response.statusCode)
}

// ── 正文截断 ──
{
  const long = 'x'.repeat(200_001)
  const routes = build({ getSkills: () => ({ get: async (name) => ({ name, description: '', content: long, invocation: { modelInvocable: true, userInvocable: true } }) }) })
  const response = await run(routes.skillBodyHandler, makeRequest('/api/agent-embodiment/status/skills/body?name=big-skill'))
  check('超长正文被截断', response.body?.truncated === true && response.body?.content?.length === 200_000, { truncated: response.body?.truncated, len: response.body?.content?.length })
  check('截断时报告原始长度', response.body?.chars === 200_001, response.body?.chars)
}

// ── 超时：注册表卡住时返回 500 而不是无限挂（用注入的短超时，避免等 8s）──
{
  const routes = build({ timeoutMs: 40, getSkills: () => ({ snapshot: () => new Promise(() => {}) }) })
  const started = Date.now()
  const response = await run(routes.skillsHandler, makeRequest('/api/agent-embodiment/status/skills'))
  const elapsed = Date.now() - started
  check('注册表卡住时超时返回 500', response.statusCode === 500 && /longer than 40ms/u.test(String(response.body?.error)), response.body?.error)
  check('超时在注入的时限内返回', elapsed < 2000, elapsed)
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[routes-skills] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1