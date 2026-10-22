/**
 * Agent Embodiment Scaffold — 纯函数生成器。
 *
 * 设计目标：AI 是思维核心，脚手架负责给它“感官 + 手 + 反馈 + 安全边界”。
 * 本文件不读写磁盘、不依赖 Cordis、不 import 任何 npm 包，方便单测和复用。
 *
 * 生成物：
 *   <workspace>/.dsh/scaffolds/<slug>/  可安装的 DSH bundle（insert 一个 agent preset）
 *   <workspace>/.agents/skills/<slug>-<skill>/SKILL.md  工作区技能（DSH skill-filesystem 会扫描）
 *
 * 安全约定：
 *   - 纯函数只返回相对路径；写盘由 host route / CLI 做绝对路径与覆盖校验。
 *   - 模板文本不含时间戳、随机数、会话 id，避免破坏提示词缓存。
 *   - 不生成任何真实 secret；只用占位符/env 引用。
 */

export const SCAFFOLD_VERSION = 1

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isRaw = (value) => isObject(value) && typeof value.__raw === 'string'

/** JSON 字符串就是合法 YAML 双引号标量；保留换行转义，避免模板文本破坏 YAML。 */
const scalar = (value) => {
  if (isRaw(value)) return value.__raw
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function emitObject(object, indent) {
  const pad = ' '.repeat(indent)
  const lines = []
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue
    if (isRaw(value)) {
      lines.push(`${pad}${key}: ${value.__raw}`)
      continue
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`)
        continue
      }
      lines.push(`${pad}${key}:`)
      for (const item of value) {
        if (isObject(item)) {
          const itemLines = emitObject(item, indent + 4)
          if (itemLines.length === 0) {
            lines.push(`${pad}  - {}`)
            continue
          }
          lines.push(`${pad}  - ${itemLines[0].slice(indent + 4)}`)
          lines.push(...itemLines.slice(1))
        } else {
          lines.push(`${pad}  - ${scalar(item)}`)
        }
      }
      continue
    }
    if (isObject(value)) {
      if (Object.keys(value).length === 0) {
        lines.push(`${pad}${key}: {}`)
        continue
      }
      lines.push(`${pad}${key}:`)
      lines.push(...emitObject(value, indent + 2))
      continue
    }
    lines.push(`${pad}${key}: ${scalar(value)}`)
  }
  return lines
}

/** 顶层必须是 YAML 数组（bundle patch 的 insert 列表）。 */
export function emitYamlArray(items) {
  const lines = []
  for (const item of items) {
    const itemLines = emitObject(item, 2)
    if (itemLines.length === 0) continue
    lines.push(`- ${itemLines[0].slice(2)}`, ...itemLines.slice(1))
  }
  return `${lines.join('\n')}\n`
}

const tool = (id, name, config) => ({ id, name, ...(config === undefined ? {} : { config }) })

const shellTools = [
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __raw: "!!js process.platform === 'win32'" } },
  { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: { __raw: "!!js process.platform !== 'win32'" } },
]

const coreTools = [
  tool('tool-fs', '@deepseek-ai/dsh-tool-fs'),
  tool('tool-fs-search', '@deepseek-ai/dsh-tool-fs-search', { sampleOverCapGlobResults: false }),
  ...shellTools,
  tool('tool-jobs', '@deepseek-ai/dsh-tool-jobs'),
  tool('tool-web', '@deepseek-ai/dsh-tool-web', { fetch: true, searchTimeoutMs: 60000 }),
  tool('tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'),
  tool('tool-todo', '@deepseek-ai/dsh-tool-todo', { allowParallelInProgress: true }),
]

const skillTools = [
  tool('skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'),
  tool('tool-skill', '@deepseek-ai/dsh-tool-skill'),
]

const compactionGroup = {
  id: 'compaction',
  name: 'cordis:group',
  group: true,
  isolate: { compaction: true, toolResultPruner: true },
  config: [
    tool('compaction-basic', '@deepseek-ai/dsh-compaction-basic'),
    tool('command-compact', '@deepseek-ai/dsh-command-compact'),
    tool('tool-result-pruner', '@deepseek-ai/dsh-compaction-tool-result-pruner', {
      thresholdChars: 8192,
      headChars: 4096,
      tailChars: 1024,
    }),
    tool('ctx-mon-and-con-control', 'ctx-mon-and-con/control', { mode: 'idle' }),
  ],
}

const subagentRows = (role, task) => [
  // dsh-subagent / spawn provider 已由基础组合全局提供；preset 只挂具体工具行，
  // 否则会重复注册 service/provider，导致 preset 激活失败。
  tool(`subagent-${role}`, '@deepseek-ai/dsh-tool-subagent', {
    provider: 'spawn',
    toolName: `delegate_${role}`,
    backgroundMode: 'one-shot',
    persona: task,
    toolFilter: { deny: ['write', 'edit', 'bash'] },
    maxDepth: 1,
  }),
]

const SENSE_SKILL = {
  name: 'sense-environment',
  description: 'Build a bounded, evidence-first snapshot of the workspace before acting: files, git state, commands, tests, and recent changes.',
  body: [
    'Use this before a non-trivial change, or whenever the task depends on the current state of the environment.',
    '',
    '## Probe sequence (read-only)',
    '1. `pwd` and list the top-level entries; do not recurse the whole tree.',
    '2. `git status --short` and `git diff --stat` if this is a git worktree.',
    '3. Find the package manifest and test/build commands; read only the relevant files.',
    '4. Confirm the runtime versions and the narrowest check that proves the change.',
    '5. If a previous snapshot exists, report only what changed since then.',
    '',
    '## Observation contract',
    'Return a compact report with: source, scope, trust level, evidence (path/command), what was omitted, and how to get more.',
    'Never paste an entire repository, log, or web page. Prefer paths, line ranges, counts, and diffs.',
    '',
    '## Stop condition',
    'Stop probing when you can name the next smallest action and the check that will prove it worked.',
  ].join('\n'),
}

const VERIFY_SKILL = {
  name: 'verify-change',
  description: 'Close the loop with a machine-readable check: run the narrowest test/build/lint/diff/screenshot and report pass, fail, or blocked.',
  body: [
    'After each meaningful action, run the narrowest check that can falsify it.',
    '',
    '## Preferred order',
    '1. The exact failing test or a focused unit test.',
    '2. Typecheck, lint, or build when the change crosses those boundaries.',
    '3. A diff review for accidental edits and scope creep.',
    '4. A screenshot or rendered output when the change is visual.',
    '',
    '## Report',
    'State the command, exit code, the key output (truncated), and the remaining risk.',
    'If the check cannot run, say why and what evidence is missing. Do not claim success without evidence.',
  ].join('\n'),
}

export const SCAFFOLD_TEMPLATES = [
  {
    id: 'repo-coder',
    name: 'Repo Coder',
    description: 'A coding agent that senses the repository, edits in small steps, and verifies with tests.',
    pattern: 'single-agent',
    persona: 'You are a careful coding agent. Ground every change in the repository before acting: read the relevant files, inspect git state and tests, then make the smallest coherent change and verify it. Prefer reversible steps and report evidence rather than assertions.',
    tools: coreTools,
    skills: [
      { name: 'repo-coder', description: 'Explore, plan, edit, and verify changes in this repository without scope creep.', body: 'Work from evidence. Read the relevant files and tests before editing. Make one coherent change at a time, keep the diff small, and run the narrowest check after each edit. Never commit or push unless the user asks.' },
    ],
    subagent: {
      role: 'review',
      task: 'You are a strict code reviewer. Read the change and its tests. Report concrete correctness, security, and test-coverage risks. Do not modify files.',
    },
    senses: ['files', 'git', 'tests', 'logs'],
    hands: ['read', 'search', 'write', 'edit', 'shell', 'background jobs'],
    context: { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9, triggerAt: 0.9, targetAt: 0.6, keepTokens: 0 },
    evals: [
      { id: 'sense-1', task: 'Find the narrowest command that runs one test.', expect: 'Names the command and the test file; does not run the full suite first.' },
      { id: 'act-1', task: 'Make a small change in an existing function.', expect: 'Reads the function first, keeps the diff local, and runs the focused test.' },
      { id: 'verify-1', task: 'A test fails after the change.', expect: 'Reports exit code and the failing assertion, then proposes the next smallest fix.' },
    ],
  },
  {
    id: 'web-researcher',
    name: 'Web Researcher',
    description: 'A research agent that gathers sources, separates evidence from inference, and verifies claims.',
    pattern: 'orchestrator-workers',
    persona: 'You are a research agent. Search broadly, read primary sources, and keep a clear distinction between what the evidence says, what you infer, and what remains unknown. Cite URLs for claims and look for disconfirming evidence before answering.',
    tools: [tool('tool-fs', '@deepseek-ai/dsh-tool-fs'), tool('tool-fs-search', '@deepseek-ai/dsh-tool-fs-search', { sampleOverCapGlobResults: false }), tool('tool-web', '@deepseek-ai/dsh-tool-web', { fetch: true, searchTimeoutMs: 60000 }), tool('tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'), tool('tool-todo', '@deepseek-ai/dsh-tool-todo', { allowParallelInProgress: true })],
    skills: [
      { name: 'web-researcher', description: 'Search, read sources, weigh evidence, and produce a cited synthesis without confusing inference for fact.', body: 'Start with a short list of questions. Search for primary sources, open the ones that can answer them, and record the URL and the exact claim. Seek at least one disconfirming source. Separate evidence, inference, and unknowns in the final answer.' },
    ],
    subagent: {
      role: 'verify',
      task: 'You are a verification researcher. Check the cited claims against the sources, look for contradictions, and report what is supported, what is not, and what is missing. Do not edit files.',
    },
    senses: ['web', 'mcp resources', 'notes'],
    hands: ['search', 'fetch', 'write notes', 'handoff'],
    context: { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9, triggerAt: 0.85, targetAt: 0.6, keepTokens: 0 },
    evals: [
      { id: 'sense-1', task: 'Answer a question that needs current sources.', expect: 'Searches first, opens primary sources, and cites URLs.' },
      { id: 'verify-1', task: 'Two sources disagree.', expect: 'Reports the disagreement and explains which source is stronger, without silently picking one.' },
    ],
  },
  {
    id: 'ops-runbook',
    name: 'Ops Runbook',
    description: 'An operations agent that inspects health, proposes exact commands, asks before destructive actions, and verifies recovery.',
    pattern: 'single-agent',
    persona: 'You are an operations agent. Inspect before changing anything. Show the exact command, its expected effect, and how you will verify recovery. Ask for confirmation before destructive or externally visible actions; never guess credentials or silently widen permissions.',
    tools: coreTools,
    skills: [
      { name: 'ops-runbook', description: 'Read-only recon, explicit change plans, confirmation gates, and recovery verification for operational tasks.', body: 'Start read-only: service status, recent logs, disk/memory, and the current configuration. Propose one change at a time with the exact command and a rollback. Ask before destructive actions. After the change, run the same health check and report before/after evidence.' },
    ],
    subagent: null,
    senses: ['logs', 'metrics', 'health checks', 'config'],
    hands: ['shell', 'background jobs', 'external tools (MCP)'],
    context: { contextWindowTokens: 128000, warnAt: 0.75, errorAt: 0.9, triggerAt: 0.8, targetAt: 0.55, keepTokens: 0 },
    evals: [
      { id: 'sense-1', task: 'A service is unhealthy.', expect: 'Collects status and recent logs before proposing a change.' },
      { id: 'act-1', task: 'A restart is required.', expect: 'Shows the exact command, asks for confirmation, and verifies health afterward.' },
    ],
  },
]

export function getTemplate(id) {
  return SCAFFOLD_TEMPLATES.find((template) => template.id === id)
}

const normalizeName = (value, fallback) => {
  const name = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  return name.slice(0, 80)
}

const normalizeDescription = (value, fallback) => {
  const description = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  return description.slice(0, 240)
}

const normalizeSlug = (value, name) => {
  const source = typeof value === 'string' && value.trim() !== '' ? value.trim() : name
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

const skillFile = (slug, skill) => `---\nname: ${slug}-${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body}\n`

const listMarkdown = (items) => items.map((item) => `- ${item}`).join('\n')

function renderSenses(template) {
  return [
    `# Senses — ${template.name}`,
    '',
    'The agent can observe the following domains. Sensors are read-only by default.',
    '',
    listMarkdown(template.senses),
    '',
    '## Observation contract',
    '',
    'Every observation should be bounded and carry:',
    '',
    '- source (tool + path/command)',
    '- scope (what was and was not read)',
    '- trust (workspace, external, inferred)',
    '- evidence (path, line range, command, exit code)',
    '- truncation and a retrieval pointer when output was capped',
    '',
    'Prefer diffs, counts, and paths over full dumps. Do not load the whole repository or a whole web page unless the task requires it.',
    '',
    '## Minimum first snapshot',
    '',
    '1. Working directory and top-level entries.',
    '2. Git status/diff when available.',
    '3. Package manifest and the narrowest test/build command.',
    '4. The specific file or system the task concerns.',
    '',
  ].join('\n')
}

function renderHands(template) {
  return [
    `# Hands — ${template.name}`,
    '',
    'The agent can act in the following domains. High-risk actions require confirmation.',
    '',
    listMarkdown(template.hands),
    '',
    '## Action contract',
    '',
    '- Read before write/edit.',
    '- Prefer the smallest reversible action.',
    '- Show the exact command or target before a destructive action.',
    '- Verify after acting; report command, exit code, and evidence.',
    '- Do not print secrets; use environment references and placeholders.',
    '',
  ].join('\n')
}

function renderLoop(template) {
  return [
    `# Loop — ${template.name}`,
    '',
    '```text',
    'sense → plan → act → verify → reflect → (repeat | stop)',
    '```',
    '',
    '## 1. Sense',
    '',
    'Use the `sense-environment` skill. Read only what the task needs. Record what changed since the last look.',
    '',
    '## 2. Plan',
    '',
    'State the goal, the next smallest action, and the check that will prove it worked.',
    '',
    '## 3. Act',
    '',
    'Make one coherent change. Keep the diff local. Prefer reversible actions.',
    '',
    '## 4. Verify',
    '',
    'Use the `verify-change` skill. Run the narrowest test/build/lint/diff/screenshot. Report pass, fail, or blocked with evidence.',
    '',
    '## 5. Reflect',
    '',
    'If the check fails, compact the error to cause + next step. If the task is done, summarize the evidence. If blocked, ask the user with the exact missing input.',
    '',
    '## Stop conditions',
    '',
    '- The success check passes and the evidence is recorded.',
    '- The task is blocked on a user-owned decision.',
    '- The next action would be destructive and has not been confirmed.',
    '',
  ].join('\n')
}

function renderAgentsSnippet(template, slug) {
  return [
    `## Agent embodiment: ${template.name} (${slug})`,
    '',
    'Before changing anything, build a bounded environment snapshot (files, git state, test/build commands, and the target system).',
    'After each meaningful change, run the narrowest check and report the command, exit code, and evidence.',
    'Prefer the smallest reversible action. Ask before destructive or externally visible operations.',
    'Keep observations small: paths, line ranges, diffs, counts, and retrieval pointers instead of full dumps.',
    '',
  ].join('\n')
}

function renderReadme(template, spec) {
  return [
    `# ${spec.name}`,
    '',
    template.description,
    '',
    'Generated by `ctx-mon-and-con` Agent Embodiment Scaffold. This is a DSH bundle that inserts an agent preset.',
    '',
    '## Install',
    '',
    'Use the same profile as the running DSH instance:',
    '',
    '```bash',
    `dsh plugin --profile <profile> add ${spec.slug === '' ? '<this bundle>' : '<absolute path to this bundle>'}`,
    '```',
    '',
    'Then open **Settings → Agent presets**, select this preset for a new session, and run the smoke test below.',
    '',
    '> The preset includes `ctx-mon-and-con/control` for context compaction. Install the `ctx-mon-and-con` plugin in the same profile first.',
    '',
    '## Smoke test',
    '',
    '1. Ask: “Give me a bounded snapshot of this workspace and the narrowest command that runs one relevant test.”',
    '2. Ask: “Make one small change, run the check, and report the exit code and evidence.”',
    '3. Confirm the agent reads before writing and does not claim success without a check.',
    '',
    '## Files',
    '',
    '- `SENSES.md` — what the agent can observe and the observation contract.',
    '- `HANDS.md` — what the agent can do and the action contract.',
    '- `LOOP.md` — the observe → plan → act → verify loop.',
    '- `skills/` — role and loop skills.',
    '- `evals/sense-act.jsonl` — starter evaluation cases.',
    '',
  ].join('\n')
}

function renderPackageJson(spec) {
  return `${JSON.stringify({
    name: `dsh-embodiment-${spec.slug}`,
    version: '0.1.0',
    private: true,
    description: spec.description,
    type: 'module',
    files: ['dsh.bundle.patch.yml', 'README.md', 'SENSES.md', 'HANDS.md', 'LOOP.md', 'AGENTS.snippet.md', 'embodiment.json', 'skills', 'evals'],
    dsh: { bundle: { patch: './dsh.bundle.patch.yml' } },
  }, null, 2)}\n`
}

function presetRow(spec, template) {
  const rows = [
    tool('persona', '@deepseek-ai/dsh-persona', { prefix: template.persona }),
    ...skillTools,
    ...template.tools,
    ...(template.subagent ? subagentRows(template.subagent.role, template.subagent.task) : []),
    compactionGroup,
  ]
  return {
    id: `preset-${spec.slug}`,
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: spec.slug,
      name: spec.name,
      description: spec.description,
      order: 50,
      plugins: rows,
    },
  }
}

/**
 * 生成一份 Embodiment Pack。
 * @param {{template: string, slug?: string, name?: string, description?: string}} input
 * @returns {{ok: true, spec: object, template: string, presetId: string, bundleDir: string, files: Array<{path: string, content: string}>, warnings: string[], installCommand: string}}
 */
export function planScaffold(input) {
  if (!isObject(input)) throw new Error('scaffold: input must be an object')
  const template = getTemplate(input.template)
  if (!template) throw new Error(`scaffold: unknown template ${JSON.stringify(input.template)}; choose ${SCAFFOLD_TEMPLATES.map((item) => item.id).join(', ')}`)

  const name = normalizeName(input.name, template.name)
  if (typeof input.slug === 'string' && input.slug.trim() !== '' && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u.test(input.slug.trim())) {
    throw new Error('scaffold: slug must match [a-z0-9][a-z0-9-]{0,63} (path separators and dots are not allowed)')
  }
  const slug = normalizeSlug(input.slug, name)
  if (!SLUG_RE.test(slug)) throw new Error('scaffold: slug must match [a-z0-9][a-z0-9-]{0,63}')
  const description = normalizeDescription(input.description, template.description)

  const spec = {
    scaffoldVersion: SCAFFOLD_VERSION,
    template: template.id,
    slug,
    name,
    description,
    pattern: template.pattern,
    context: template.context,
    senses: template.senses,
    hands: template.hands,
  }

  const bundleDir = `.dsh/scaffolds/${slug}`
  const commonSkills = [
    { ...SENSE_SKILL, name: 'sense-environment' },
    { ...VERIFY_SKILL, name: 'verify-change' },
    ...template.skills,
  ]

  const files = []
  const add = (path, content) => files.push({ path, content })
  add(`${bundleDir}/package.json`, renderPackageJson(spec))
  add(`${bundleDir}/dsh.bundle.patch.yml`, emitYamlArray([{ insert: [presetRow(spec, template)] }]))
  add(`${bundleDir}/embodiment.json`, `${JSON.stringify(spec, null, 2)}\n`)
  add(`${bundleDir}/README.md`, renderReadme(template, spec))
  add(`${bundleDir}/SENSES.md`, renderSenses(template))
  add(`${bundleDir}/HANDS.md`, renderHands(template))
  add(`${bundleDir}/LOOP.md`, renderLoop(template))
  add(`${bundleDir}/AGENTS.snippet.md`, renderAgentsSnippet(template, slug))
  for (const skill of commonSkills) {
    const content = skillFile(slug, skill)
    add(`${bundleDir}/skills/${skill.name}/SKILL.md`, content)
    add(`.agents/skills/${slug}-${skill.name}/SKILL.md`, content)
  }
  add(`${bundleDir}/evals/sense-act.jsonl`, `${template.evals.map((item) => JSON.stringify(item)).join('\n')}\n`)
  add(`${bundleDir}/evals/README.md`, [
    '# Sense-act eval cases',
    '',
    'Run these cases against a session using this preset. Record pass/fail, steps, tool calls, and observation tokens.',
    '',
    'Use the repository eval harness or a manual transcript; do not treat a plausible answer as a pass without evidence.',
    '',
  ].join('\n'))

  const warnings = [
    `Preset id "${slug}" must be unique in the target profile; change the slug if it already exists.`,
    'The generated preset includes ctx-mon-and-con/control; install the ctx-mon-and-con plugin in the same profile.',
    'The preset is not selected as the new-session default automatically; choose it in Settings → Agent presets.',
    'MCP servers are not generated in this version; add them explicitly after reviewing the command and credentials.',
  ]

  return {
    ok: true,
    spec,
    template: template.id,
    presetId: slug,
    bundleDir,
    files,
    warnings,
    installCommand: `dsh plugin --profile <profile> add <workspace>/${bundleDir}`,
  }
}
