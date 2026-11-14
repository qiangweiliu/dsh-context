/**
 * 一次性拆分脚本：把单文件 client.js 按顶层锚点切成 client-src/ 下的若干片段，
 * 再按顺序拼回并**断言与原文逐字节相同**（拆错一个字节就报错退出）。
 *
 * 用法：node scripts/client-split.mjs
 * 之后日常改动走 client-src/ + `npm run build:client`；本脚本只在首次拆分或锚点变化时用。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const clientPath = join(root, 'client.js')
const outDir = join(root, 'client-src')
const source = readFileSync(clientPath, 'utf8')

/** 每段以「从该行开始」为界；顺序即拼接顺序。 */
const SEGMENTS = [
  { file: '00-head.js', anchor: null },
  { file: '10-locale.js', anchor: 'const en = {' },
  { file: '20-styles.js', anchor: 'const styles = {' },
  { file: '30-core.js', anchor: 'function Card(' },
  { file: '40-dock.js', anchor: 'function CtxDock(' },
  { file: '45-inventory.js', anchor: 'function InventoryCard(' },
  { file: '50-sections.js', anchor: 'function ControlSection(' },
  { file: '55-charts.js', anchor: 'function KpiBand(' },
  { file: '60-scaffold.js', anchor: 'function ScaffoldPanel(' },
  { file: '70-panel.js', anchor: 'function CtxPanel(' },
  { file: '90-apply.js', anchor: 'function apply(ctx) {' },
]

const lines = source.split('\n')
const offsets = []
let cursor = 0
for (const line of lines) {
  offsets.push(cursor)
  cursor += line.length + 1
}

const startIndex = (anchor) => {
  if (anchor === null) return 0
  // 按「去掉缩进后是否以锚点开头」匹配：源码缩进可能随编辑变化，行号也不要硬编码。
  const index = lines.findIndex((line) => line.trimStart().startsWith(anchor))
  if (index < 0) throw new Error(`找不到锚点：${JSON.stringify(anchor)}`)
  return index
}

const starts = SEGMENTS.map((segment) => startIndex(segment.anchor))
for (let i = 1; i < starts.length; i += 1) {
  if (starts[i] <= starts[i - 1]) throw new Error(`锚点顺序不对：${SEGMENTS[i].file}`)
}

mkdirSync(outDir, { recursive: true })
const pieces = []
for (let i = 0; i < SEGMENTS.length; i += 1) {
  const from = offsets[starts[i]]
  const to = i + 1 < SEGMENTS.length ? offsets[starts[i + 1]] : source.length
  const text = source.slice(from, to)
  pieces.push(text)
  writeFileSync(join(outDir, SEGMENTS[i].file), text, 'utf8')
}

const rebuilt = pieces.join('')
if (rebuilt !== source) {
  console.error('[split] 拼接结果与原文不一致，已中止（client-src 可能已写入，请用 git checkout 恢复）')
  process.exit(1)
}
console.log(`[split] 已写入 ${SEGMENTS.length} 个片段到 client-src/，拼接校验通过（${source.length} 字节）`)
