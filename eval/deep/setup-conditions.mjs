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
 * 以便在几十轮内触发压缩。凭据文件只复制到隔离 DSH_HOME，不打印内容。
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
  if (existsSync(CREDENTIALS)) copyFileSync(CREDENTIALS, join(home, '.credentials.yaml'))
  else console.warn(`[deep-setup] credentials not found: ${CREDENTIALS}`)
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
  next: [
    `node eval/deep/run.mjs --condition base --workers 3 --out eval/results/deep-b-base.jsonl`,
    `node eval/deep/run.mjs --condition plugin --workers 3 --out eval/results/deep-b-plugin.jsonl`,
    `node eval/deep/run.mjs --condition scaffold --workers 3 --out eval/results/deep-b-scaffold.jsonl`,
    `node eval/deep/run.mjs --condition compact --workers 3 --out eval/results/deep-b-compact.jsonl`,
  ],
}, null, 2))
