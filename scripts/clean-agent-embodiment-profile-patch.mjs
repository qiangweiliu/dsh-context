#!/usr/bin/env node
// 卸载 agent-embodiment 后清理 profile 里由插件写入的 patch 行：
//   - 顶层 `- id: agent-embodiment`
//   - `- id: agent-embodiment-control`（任何时候）
//   - `- id: preset-standard` 整段，仅当该段里包含 agent-embodiment-control
//     （这是插件自动挂载时用 configEditor 写出的整段 preset 覆盖）
// 先备份为 cordis.patch.yml.embody-backup-<时间戳>，再原地改写。
// 用法：node clean-agent-embodiment-profile-patch.mjs <profile 目录或 cordis.patch.yml 路径>
import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2]
if (!input) {
  console.error('usage: node clean-agent-embodiment-profile-patch.mjs <profile dir | cordis.patch.yml>')
  process.exit(2)
}
const stat = fs.statSync(input)
const file = stat.isDirectory() ? path.join(input, 'cordis.patch.yml') : input
if (!fs.existsSync(file)) {
  console.log('no patch file:', file)
  process.exit(0)
}

const original = fs.readFileSync(file, 'utf8')
const lines = original.split(/\r?\n/)

// 顶层条目：形如 `- id: xxx` 或 `- ` 开头且无缩进
const starts = []
for (let i = 0; i < lines.length; i++) {
  if (/^-( |$)/.test(lines[i])) starts.push(i)
}

const remove = new Set()
const blocks = []
for (let k = 0; k < starts.length; k++) {
  const from = starts[k]
  const to = k + 1 < starts.length ? starts[k + 1] : lines.length
  const block = lines.slice(from, to)
  const inline = block[0].match(/^-\s*id:\s*(.+)$/)
  const nested = block.find((line) => /^\s+id:/.test(line))
  const rawId = inline?.[1] ?? nested?.match(/^\s+id:\s*(.+)$/)?.[1] ?? null
  const id = rawId ? rawId.trim().replace(/^['"]|['"]$/g, '') : null
  blocks.push({ from, to, id, body: block.join('\n') })
}

for (const block of blocks) {
  if (block.id === 'agent-embodiment' || block.id === 'agent-embodiment-control') {
    remove.add(block.id)
    for (let i = block.from; i < block.to; i++) lines[i] = null
  } else if (block.id === 'preset-standard' && block.body.includes('agent-embodiment-control')) {
    remove.add('preset-standard(auto-mount)')
    for (let i = block.from; i < block.to; i++) lines[i] = null
  }
}

if (remove.size === 0) {
  console.log('nothing to clean:', file)
  process.exit(0)
}

const next = lines.filter((line) => line !== null).join('\n').replace(/\n{3,}/g, '\n\n')
const backup = `${file}.embody-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.writeFileSync(backup, original, 'utf8')
fs.writeFileSync(file, next, 'utf8')
console.log('cleaned:', [...remove].join(', '))
console.log('backup:', backup)
