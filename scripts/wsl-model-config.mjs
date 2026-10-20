// 把 Windows desktop profile 里的 opencode-go 配置搬进 WSL 的 headless / web profile。
// 只打印 id 与是否写入，不打印 apiKey。
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = '/mnt/c/Users/40410/.dsh/profiles/desktop/cordis.patch.yml'
const targets = [
  '/home/wu/.dsh/profiles/headless/cordis.patch.yml',
  '/home/wu/.dsh/profiles/web/cordis.patch.yml',
]
const WANT = ['agent-default-model', 'llm-pi-ai']

const lines = readFileSync(SRC, 'utf8').split('\n')

function sliceEntry(id) {
  const start = lines.findIndex((line) => new RegExp(`^- id: ${id}\\s*$`).test(line))
  if (start < 0) throw new Error(`源文件里找不到 ${id}`)
  let end = start + 1
  while (end < lines.length && !/^- /.test(lines[end])) end += 1
  return lines.slice(start, end).join('\n').replace(/\n+$/, '')
}

const entries = WANT.map((id) => ({ id, text: sliceEntry(id) }))
for (const entry of entries) {
  const masked = entry.text.replace(/(apiKey:\s*).*/g, '$1<masked>')
  console.log(`[src] ${entry.id}: ${entry.text.split('\n').length} 行`)
  if (entry.id === 'agent-default-model') console.log(masked)
}

function stripEntry(text, id) {
  const body = text.split('\n')
  const out = []
  let skipping = false
  for (const line of body) {
    if (new RegExp(`^- id: ${id}\\s*$`).test(line)) {
      skipping = true
      continue
    }
    if (skipping && /^- /.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n+$/, '')
}

for (const file of targets) {
  let current = readFileSync(file, 'utf8')
  const header = current.startsWith('#') ? current.split('\n').filter((l) => l.startsWith('#')).join('\n') : ''
  let body = stripEntry(current, WANT[0])
  body = stripEntry(body, WANT[1])
  // 去掉空的 [] 占位与尾部空白
  body = body
    .split('\n')
    .filter((line) => line.trim() !== '[]')
    .join('\n')
    .replace(/\n+$/, '')
  const appended = entries.map((entry) => entry.text).join('\n')
  const next = `${[header, body, appended].filter((chunk) => chunk.trim() !== '').join('\n')}\n`
  writeFileSync(file, next)
  const check = next.match(/provider: (\S+)/)
  const model = next.match(/model: (\S+)/)
  console.log(`[write] ${file} → provider=${check ? check[1] : '?'} model=${model ? model[1] : '?'} · ${next.split('\n').length} 行`)
}
