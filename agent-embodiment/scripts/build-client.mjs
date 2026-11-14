/**
 * 把 client-src/ 下的片段按固定顺序拼成发布用的单文件 client.js。
 *
 * 为什么要构建：DSH 浏览器侧只加载一个 `client.js` 文件（`exports["./client"]`），
 * 且模块内只能 `require('react')`，没有打包器可用。所以源码按功能拆成多个片段放在
 * client-src/，发布物仍是单文件——改完源码必须跑本脚本，CI 有防漂移测试兜底。
 *
 * 用法：npm run build:client
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** 拼接顺序：与 scripts/client-split.mjs 的 SEGMENTS 保持一致（文件名前缀即顺序）。 */
export const ORDER = [
  '00-head.js',
  '10-locale.js',
  '20-styles.js',
  '30-core.js',
  '40-dock.js',
  '45-inventory.js',
  '50-sections.js',
  '55-charts.js',
  '60-scaffold.js',
  '70-panel.js',
  '90-apply.js',
]

/** 读出所有片段并按顺序拼接；导出给防漂移测试复用，避免两处各写一份。 */
export function buildClient(rootDir = root) {
  return ORDER.map((file) => readFileSync(join(rootDir, 'client-src', file), 'utf8')).join('')
}

const target = join(root, 'client.js')

// 只有被直接执行时才写文件；被测试 import（复用 ORDER / buildClient）时保持纯函数语义。
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])
if (invokedDirectly) {
  const next = buildClient(root)
  const previous = (() => {
    try {
      return readFileSync(target, 'utf8')
    } catch {
      return ''
    }
  })()

  if (next === previous) {
    console.log('[build:client] 无变化')
  } else {
    writeFileSync(target, next, 'utf8')
    console.log(`[build:client] 已写入 client.js（${next.length} 字节，${ORDER.length} 个片段）`)
  }
}
