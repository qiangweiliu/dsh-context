/**
 * profile 识别与状态目录迁移的离线测试。
 *
 * 运行：node test/profile.mjs
 * 覆盖：link 依赖 / 普通依赖 / 不匹配 / 目录不存在 / 非法 profile 名 / 迁移不覆盖。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectProfileName, migrateStateFiles, stateDirFor } from '../profile.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const root = mkdtempSync(join(tmpdir(), 'embody-profile-'))
const profiles = join(root, 'profiles')
mkdirSync(profiles, { recursive: true })
const selfDir = join(root, 'plugin-copy')
mkdirSync(selfDir, { recursive: true })

const writeProfile = (name, manifest) => {
  const dir = join(profiles, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  return dir
}

// 1) link: 依赖指向本插件目录 -> 命中
writeProfile('desktop', { name: 'dsh-profile-desktop', dependencies: { 'agent-embodiment': `link:${selfDir.replace(/\\/g, '/')}` } })
check('link 依赖指向本目录时识别 profile', detectProfileName(profiles, selfDir) === 'desktop', detectProfileName(profiles, selfDir))

// 2) link: 指向别处 -> 不命中
writeProfile('other', { dependencies: { 'agent-embodiment': `link:${join(root, 'nope').replace(/\\/g, '/')}` } })
check('link 指向其他目录时不误判', detectProfileName(profiles, join(root, 'another-copy')) === null, detectProfileName(profiles, join(root, 'another-copy')))

// 3) 普通版本依赖：node_modules/agent-embodiment 的真实路径 == 本目录
const installed = writeProfile('web', { dependencies: { 'agent-embodiment': '0.24.1' } })
const installedPkg = join(installed, 'node_modules', 'agent-embodiment')
mkdirSync(installedPkg, { recursive: true })
check('node_modules 安装布局也能识别', detectProfileName(profiles, installedPkg) === 'web', detectProfileName(profiles, installedPkg))

// 4) 没有 profiles 目录 -> null（沿用共享目录）
check('profiles 目录不存在时返回 null', detectProfileName(join(root, 'missing'), selfDir) === null, detectProfileName(join(root, 'missing'), selfDir))

// 5) 状态目录：识别到才分层，非法名字不拼接
check('识别到 profile 时放进 profiles/<name>', stateDirFor('/base', 'desktop') === join('/base', 'profiles', 'desktop'), stateDirFor('/base', 'desktop'))
check('没有 profile 时沿用旧目录', stateDirFor('/base', null) === '/base', stateDirFor('/base', null))
check('非法 profile 名不参与拼接', stateDirFor('/base', '../evil') === '/base', stateDirFor('/base', '../evil'))

// 6) 迁移：只补缺失文件，不覆盖已有内容
const legacyDir = join(root, 'legacy')
const targetDir = join(root, 'legacy', 'profiles', 'desktop')
mkdirSync(legacyDir, { recursive: true })
mkdirSync(targetDir, { recursive: true })
writeFileSync(join(legacyDir, 'session-toggles.json'), '{"legacy":true}')
writeFileSync(join(legacyDir, 'onboarding.json'), '{"legacy":true}')
writeFileSync(join(targetDir, 'onboarding.json'), '{"profile":true}')
const copied = migrateStateFiles(legacyDir, targetDir)
check('迁移复制缺失文件', copied.includes('session-toggles.json') && !copied.includes('onboarding.json'), copied)
check('迁移不覆盖已有文件', readFileSync(join(targetDir, 'onboarding.json'), 'utf8').includes('profile'), readFileSync(join(targetDir, 'onboarding.json'), 'utf8'))
check('迁移后目标文件存在', existsSync(join(targetDir, 'session-toggles.json')))
check('源目录与目标相同时不复制', migrateStateFiles(legacyDir, legacyDir).length === 0)

try {
  rmSync(root, { recursive: true, force: true })
} catch {}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[profile] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[profile] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
