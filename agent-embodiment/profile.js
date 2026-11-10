/**
 * profile 识别与状态目录迁移。
 *
 * 背景：0.24.1 之前所有状态（会话开关 / 首次引导 / 压缩日志 / 备份）都写在
 * `~/.dsh/agent-embodiment/`，同一台机器上的 desktop、web、uitest 等 profile
 * 会互相覆盖。这里按「哪个 profile 的依赖真的指向本插件目录」来识别当前 profile，
 * 识别不出来就继续用旧的共享目录（行为不变，避免误判后写错位置）。
 *
 * 只依赖 Node 内置模块，不依赖 Cordis，便于单测。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 需要按 profile 隔离的状态文件。 */
export const STATE_FILES = ['session-toggles.json', 'onboarding.json', 'compaction-log.jsonl']

/** 插件包名（profile 依赖里的键）。 */
const PACKAGE = 'agent-embodiment'

/**
 * 找出「哪个 profile 装的是当前这份插件副本」。
 * 依据 profile 的 package.json：`link:<path>` 直接比较路径，普通版本依赖比较
 * `node_modules/agent-embodiment` 的真实路径。同一路径被多个 profile 引用时返回第一个。
 *
 * @param {string} profilesRoot 例如 ~/.dsh/profiles
 * @param {string} selfPath 本插件目录（index.js 所在目录）
 * @returns {string | null} profile 名；无法确定时 null
 */
export function detectProfileName(profilesRoot, selfPath) {
  try {
    if (typeof profilesRoot !== 'string' || typeof selfPath !== 'string') return null
    if (!existsSync(profilesRoot)) return null
    const self = resolve(selfPath)
    for (const name of readdirSync(profilesRoot).sort()) {
      const profileDir = join(profilesRoot, name)
      const manifestPath = join(profileDir, 'package.json')
      if (!existsSync(manifestPath)) continue
      let manifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        continue
      }
      const spec = manifest?.dependencies?.[PACKAGE]
      if (typeof spec !== 'string') continue
      const target = spec.startsWith('link:')
        ? resolve(profileDir, spec.slice('link:'.length))
        : join(profileDir, 'node_modules', PACKAGE)
      if (!existsSync(target)) continue
      if (resolve(target) === self) return name
    }
  } catch {}
  return null
}

/**
 * 计算状态目录：识别出 profile 时放进 `profiles/<name>/`，否则沿用共享目录。
 *
 * @param {string} baseDir 旧共享目录（~/.dsh/agent-embodiment）
 * @param {string | null} profileName detectProfileName 的结果
 */
export function stateDirFor(baseDir, profileName) {
  if (typeof profileName !== 'string' || profileName.length === 0) return baseDir
  // 只允许安全字符，避免 profile 名里的分隔符把目录带出去。
  if (!/^[A-Za-z0-9._-]+$/u.test(profileName)) return baseDir
  return join(baseDir, 'profiles', profileName)
}

/**
 * 把旧共享目录里的状态文件复制到新的 profile 目录（只补齐缺失文件，不覆盖）。
 * @returns {string[]} 实际复制的文件名
 */
export function migrateStateFiles(sourceDir, targetDir) {
  const copied = []
  try {
    if (sourceDir === targetDir || !existsSync(sourceDir)) return copied
    mkdirSync(targetDir, { recursive: true })
    for (const file of STATE_FILES) {
      const from = join(sourceDir, file)
      const to = join(targetDir, file)
      if (existsSync(from) && !existsSync(to)) {
        copyFileSync(from, to)
        copied.push(file)
      }
    }
  } catch {}
  return copied
}
