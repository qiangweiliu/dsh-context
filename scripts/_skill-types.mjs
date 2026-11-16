import { readFileSync } from 'node:fs'

const asar = 'E:\\tool\\dsh\\resources\\app.asar'
const buffer = readFileSync(asar)
const headerSize = buffer.readUInt32LE(12)
const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8'))
const dataOffset = 16 + headerSize

const files = new Map()
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, `${path}/${name}`)
  } else if (node.offset !== undefined) {
    files.set(path, { offset: Number(node.offset), size: Number(node.size) })
  }
}
walk(header, '')

const read = (path) => {
  const entry = files.get(path)
  return entry ? buffer.subarray(dataOffset + entry.offset, dataOffset + entry.offset + entry.size).toString('utf8') : null
}

const base = '/dsh/node_modules/@deepseek-ai/dsh-skill'
console.log('=== dsh-skill 包内文件 ===')
for (const path of [...files.keys()].filter((p) => p.startsWith(base))) {
  console.log(' ', path.replace(base, '.'), files.get(path).size, 'bytes')
}

for (const candidate of [`${base}/lib/index.d.ts`, `${base}/src/index.ts`, `${base}/package.json`]) {
  const text = read(candidate)
  if (!text) continue
  console.log(`\n===== ${candidate.replace(base, '.')} =====`)
  console.log(text.slice(0, 5000))
}