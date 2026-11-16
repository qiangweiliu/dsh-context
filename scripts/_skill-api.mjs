import { readFileSync } from 'node:fs'

const asar = 'E:\\tool\\dsh\\resources\\app.asar'
const buffer = readFileSync(asar)
const headerSize = buffer.readUInt32LE(12)
const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8'))
const dataOffset = 16 + headerSize
const files = new Map()
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return
  if (node.files) for (const [name, child] of Object.entries(node.files)) walk(child, `${path}/${name}`)
  else if (node.offset !== undefined) files.set(path, { offset: Number(node.offset), size: Number(node.size) })
}
walk(header, '')
const read = (path) => {
  const entry = files.get(path)
  return entry ? buffer.subarray(dataOffset + entry.offset, dataOffset + entry.offset + entry.size).toString('utf8') : null
}

const text = read('/dsh/node_modules/@deepseek-ai/dsh-skill/src/index.ts')
const lines = text.split('\n')

const wanted = /export interface Skill(Summary|Definition|Catalog|Snapshot)|^\s+(async )?(list|snapshot|load|register|registerProvider|resolve)\s*[(<]|^export class|^export default class|resolveSkill|interface .*Observation|coverage|incomplete/u

let printing = false
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  if (wanted.test(line)) {
    printing = true
    console.log(`\n--- L${index + 1} ---`)
  } else if (printing && /^\}/u.test(line) && index > 0) {
    console.log(line)
    printing = false
    continue
  } else if (printing && line.trim() === '' && lines[index + 1] && /^\s*(export|\})/u.test(lines[index + 1])) {
    printing = false
  }
  if (printing) console.log(line)
}