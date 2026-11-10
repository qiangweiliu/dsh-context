#!/usr/bin/env node
/**
 * 同步插件版本号到所有手工维护的副本。
 *
 * 用法：node scripts/bump-version.mjs 0.24.1
 *
 * 更新范围（只改“当前版本”这类声明，不改历史记录）：
 *   - agent-embodiment/package.json 的 version
 *   - agent-embodiment/client.js 的 CLIENT_VERSION
 *   - README.md / agent-embodiment/README.md 的“当前版本”
 *   - agent-embodiment/docs/IMPLEMENTATION.md 的“当前版本”
 *
 * CHANGELOG、EVIDENCE、市场条目、release tag 仍由人确认后手写/手打，脚本只提醒。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const version = process.argv[2]

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(String(version ?? ''))) {
  console.error('用法：node scripts/bump-version.mjs <semver>（例如 0.24.1）')
  process.exit(2)
}

const pluginDir = join(root, 'agent-embodiment')
const changed = []

function patch(relativePath, transform) {
  const file = join(root, relativePath)
  const before = readFileSync(file, 'utf8')
  const after = transform(before)
  if (after !== before) {
    writeFileSync(file, after, 'utf8')
    changed.push(relativePath)
  }
}

patch('agent-embodiment/package.json', (text) => {
  const manifest = JSON.parse(text)
  manifest.version = version
  return JSON.stringify(manifest, null, 2) + '\n'
})

patch('agent-embodiment/client.js', (text) => text.replace(/(const CLIENT_VERSION = ')[^']+(')/u, `$1${version}$2`))

for (const file of ['README.md', 'agent-embodiment/README.md']) {
  patch(file, (text) => text.replace(/(当前版本：`)[^`]+(`)/u, `$1${version}$2`))
}

patch('agent-embodiment/docs/IMPLEMENTATION.md', (text) => text.replace(/(当前版本：`)[^`]+(`)/u, `$1${version}$2`))

console.log(`[bump] ${version} 已写入：${changed.length > 0 ? changed.join(', ') : '（无需修改）'}`)
console.log('[bump] 还需要手动处理：')
console.log('  - agent-embodiment/CHANGELOG.md 增加版本小节')
console.log('  - agent-embodiment/docs/EVIDENCE.md 补验收记录（如有）')
console.log('  - git tag v' + version + '（发布时）')
