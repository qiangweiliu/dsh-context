/**
 * 纯离线测试：状态文件原子写、写前备份与备份读取（不依赖 Cordis / DSH）。
 *
 * 运行：node test/persist.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile, backupFile, latestBackupJson } from '../persist.js'

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${detail})`}`)
}

const root = mkdtempSync(join(tmpdir(), 'embody-persist-'))
const backups = join(root, 'backups')

// 原子写：内容正确，且不残留临时文件。
const target = join(root, 'state.json')
atomicWriteFile(target, '{"a":1}\n')
check('原子写：目标文件内容正确', readFileSync(target, 'utf8') === '{"a":1}\n', readFileSync(target, 'utf8'))
const leftovers = (await import('node:fs')).readdirSync(root).filter((name) => name.includes('.tmp-'))
check('原子写：不残留临时文件', leftovers.length === 0, leftovers.join(','))

// 覆盖写：rename 覆盖旧内容。
atomicWriteFile(target, '{"a":2}\n')
check('原子写：覆盖已有文件', readFileSync(target, 'utf8') === '{"a":2}\n', readFileSync(target, 'utf8'))

// 备份：不存在源文件时不创建备份。
const warnings = []
backupFile(backups, join(root, 'missing.json'), 'missing', (message) => warnings.push(message))
check('备份：源文件缺失时静默跳过', warnings.length === 0 && latestBackupJson(backups, 'missing') === null, warnings.join('|'))

// 备份：写入后能取回最新一份。
writeFileSync(target, '{"a":3}\n', 'utf8')
backupFile(backups, target, 'state')
check('备份：可读取最新备份内容', latestBackupJson(backups, 'state')?.a === 3, latestBackupJson(backups, 'state'))

// 备份轮转：只保留最近 keep 份。
for (let index = 0; index < 5; index += 1) {
  writeFileSync(target, `{"a":${index}}\n`, 'utf8')
  backupFile(backups, target, 'state', () => {}, 3)
}
const rotated = (await import('node:fs')).readdirSync(backups).filter((name) => name.startsWith('state.'))
check('备份：按 keep 轮转', rotated.length === 3, rotated.join(','))

// 最新备份损坏时返回 null，不抛错。
const { readdirSync } = await import('node:fs')
const newest = readdirSync(backups).filter((name) => name.startsWith('state.')).sort().pop()
writeFileSync(join(backups, newest), 'not json', 'utf8')
check('备份：最新备份损坏返回 null', latestBackupJson(backups, 'state') === null)

rmSync(root, { recursive: true, force: true })

const failed = checks.filter((item) => !item.ok)
console.log(`\n[persist] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error(`[persist] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
