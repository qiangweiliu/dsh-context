/**
 * 状态文件的小工具：原子写、写前备份、备份读取。
 *
 * 这些函数只做文件系统操作，不依赖 Cordis/DSH，便于单独测试：
 * 状态文件在断电、崩溃或磁盘写满时最容易损坏，原子落盘能把损失收敛到“最后一次写入”，
 * 读不到主文件时再从最近一份备份恢复。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Write a file atomically: write a sibling temp file, then rename it over the target.
 * On every platform Node's rename replaces an existing file, so readers never see a
 * partially written document.
 *
 * @param {string} filePath - absolute target path.
 * @param {string} text - complete new content.
 */
export function atomicWriteFile(filePath, text) {
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, filePath)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {}
    throw error
  }
}

/**
 * Copy a file into the backup directory before it is overwritten.
 *
 * @param {string} backupDir - directory holding `<label>.<stamp>.bak` files.
 * @param {string} filePath - file to snapshot; a missing file is a no-op.
 * @param {string} label - logical file name used as the backup prefix.
 * @param {(message: string) => void} [warn] - receives a message when the backup fails.
 * @param {number} [keep] - how many backups to retain (default 30).
 */
export function backupFile(backupDir, filePath, label, warn = () => {}, keep = 30) {
  try {
    if (!filePath || !existsSync(filePath)) return
    mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    // 同一毫秒内多次写入时时间戳会相同；加序号避免互相覆盖。
    let name = `${label}.${stamp}.bak`
    for (let serial = 1; existsSync(join(backupDir, name)); serial += 1) name = `${label}.${stamp}-${serial}.bak`
    copyFileSync(filePath, join(backupDir, name))
    const names = readdirSync(backupDir).filter((name) => name.startsWith(label + '.')).sort()
    while (names.length > keep) {
      const stale = names.shift()
      try {
        unlinkSync(join(backupDir, stale))
      } catch {}
    }
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Parse the newest backup for a label.
 *
 * @param {string} backupDir - directory holding `<label>.<stamp>.bak` files.
 * @param {string} label - logical file name used as the backup prefix.
 * @returns {unknown | null} parsed JSON of the newest readable backup, or null.
 */
export function latestBackupJson(backupDir, label) {
  try {
    const names = readdirSync(backupDir).filter((name) => name.startsWith(label + '.'))
    if (names.length === 0) return null
    // 按修改时间取最新；文件名里的时间戳只到毫秒，同毫秒写入时不可靠。
    const newest = names
      .map((name) => ({ name, at: statSync(join(backupDir, name)).mtimeMs }))
      .sort((left, right) => left.at - right.at || left.name.localeCompare(right.name))
      .at(-1)
    return JSON.parse(readFileSync(join(backupDir, newest.name), 'utf8'))
  } catch {
    return null
  }
}
