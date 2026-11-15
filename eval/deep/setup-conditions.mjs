#!/usr/bin/env node
/**
 * 准备四组对照条件所需的隔离 DSH_HOME。
 *
 *   node eval/deep/setup-conditions.mjs \
 *     --from ~/.dsh/profiles/headless \
 *     --credentials ~/.dsh/.credentials.yaml
 *
 * 产物：
 *   /tmp/dsh-memory-base     仅 dsh-base + dsh-headless，16k/40k 级测试配置
 *   /tmp/dsh-memory-plugin   同上 + agent-embodiment
 *   /tmp/deep-scaffold       生成的 repo-coder 脚手架（skills）
 *
 * 说明：从现有 headless profile 复制 provider 配置，但把模型声明的上下文窗口
 * 调小到 40000、输出上限 16000，并给 compaction-basic 设置小 headroom/保留比例，
 * 以便在几十轮内触发压缩。
 *
 * 注意：这套 tuning 是为 **compaction 类实验**准备的。模板评估已于 0.48.0 停止
 * （4 个 experimental 模板永久保持 experimental），相关工具归档在
 * eval/deep/archive/templates/；将来若重开，别复用这里的窗口缩放。
 *
 * 凭据默认**不**复制：headless 的 llm-pi-ai 读 `apiKeyEnv: OPENCODE_GO_API_KEY`，
 * 运行时 export 即可。需要复制时显式 `--copy-credentials`（会在 home 里留明文）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const ROOT = resolve(import.meta.dirname, '..', '..')
const FROM = resolve(flag('from', join(homedir(), '.dsh', 'profiles', 'headless')))
const CREDENTIALS = resolve(flag('credentials', join(homedir(), '.dsh', '.credentials.yaml')))
const BASE = resolve(flag('base-home', '/tmp/dsh-memory-base'))
const PLUGIN = resolve(flag('plugin-home', '/tmp/dsh-memory-plugin'))
const SCAFFOLD = resolve(flag('scaffold-home', '/tmp/deep-scaffold'))
// 默认**不**把凭据文件复制进隔离 home：那是明文密钥的多份副本。改为运行时用环境
// 变量注入（headless 的 llm-pi-ai 读 apiKeyEnv: OPENCODE_GO_API_KEY）。
// 需要复制时显式加 --copy-credentials，且应放在不共享、可删除的位置。
const COPY_CREDENTIALS = args.includes('--copy-credentials')

function writeProfile(home) {
  const profile = join(home, 'profiles', 'headless')
  mkdirSync(profile, { recursive: true })
  copyFileSync(join(FROM, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'))
  copyFileSync(join(FROM, 'cordis.yml'), join(profile, 'cordis.yml'))
  rmSync(join(profile, 'node_modules'), { recursive: true, force: true })
  if (existsSync(join(FROM, 'node_modules'))) symlinkSync(join(FROM, 'node_modules'), join(profile, 'node_modules'))
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
  }, null, 2)}\n`)
  mkdirSync(join(home, 'sessions'), { recursive: true })
  if (COPY_CREDENTIALS) {
    if (existsSync(CREDENTIALS)) {
      copyFileSync(CREDENTIALS, join(home, '.credentials.yaml'))
      console.warn(`[deep-setup] 已复制凭据到 ${join(home, '.credentials.yaml')}（明文，用完请删除）`)
    } else {
      console.warn(`[deep-setup] credentials not found: ${CREDENTIALS}`)
    }
  }
}

function tunePatch(home) {
  const file = join(home, 'profiles', 'headless', 'cordis.patch.yml')
  const lines = readFileSync(file, 'utf8').split('\n')
  let inside = false
  const output = []
  for (const line of lines) {
    if (line.trim() === '- id: deepseek-v4.1-flash') inside = true
    else if (inside && line.trim().startsWith('- id: ')) inside = false
    let next = line
    if (inside && line.includes('contextWindow:')) next = line.replace(/contextWindow:\s*\d+/u, 'contextWindow: 40000')
    if (inside && line.includes('maxTokens:')) next = line.replace(/maxTokens:\s*\d+/u, 'maxTokens: 16000')
    output.push(next)
  }
  output.push('', '- id: compaction-basic', '  name: "@deepseek-ai/dsh-compaction-basic"', '  config:', '    headroomTokens: 1024', '    retainRatio: 0.05', '    maxTokens: 4096')
  writeFileSync(file, `${output.join('\n')}\n`)
}

writeProfile(BASE)
tunePatch(BASE)
writeProfile(PLUGIN)
tunePatch(PLUGIN)
const pluginProfile = join(PLUGIN, 'profiles', 'headless')
const manifestPath = join(pluginProfile, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies = { 'agent-embodiment': `link:${join(ROOT, 'agent-embodiment')}` }
manifest.dsh.profile.bundles.push('agent-embodiment')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
rmSync(join(pluginProfile, 'node_modules', 'agent-embodiment'), { recursive: true, force: true })
symlinkSync(join(ROOT, 'agent-embodiment'), join(pluginProfile, 'node_modules', 'agent-embodiment'))

execFileSync('node', [join(ROOT, 'scripts', 'agent-scaffold.mjs'), '--template', 'repo-coder', '--out', SCAFFOLD, '--slug', 'mem-coder'], { stdio: 'inherit' })

console.log(JSON.stringify({
  base: BASE,
  plugin: PLUGIN,
  scaffold: SCAFFOLD,
  credentials: COPY_CREDENTIALS ? 'copied (明文，用完请删)' : 'not copied → 运行时注入 OPENCODE_GO_API_KEY',
  next: [
    'export OPENCODE_GO_API_KEY=...   # 不复制凭据时必须先导出',
    'node eval/deep/run.mjs --condition base --workers 3 --out eval/results/deep-b-base.jsonl',
    'node eval/deep/run.mjs --condition plugin --workers 3 --out eval/results/deep-b-plugin.jsonl',
    'node eval/deep/run.mjs --condition scaffold --workers 3 --out eval/results/deep-b-scaffold.jsonl',
    'node eval/deep/run.mjs --condition compact --workers 3 --out eval/results/deep-b-compact.jsonl',
  ],
}, null, 2))
