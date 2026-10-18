import fs from 'node:fs'

const asar = process.argv[2]
console.log('asar:', asar)
try {
  console.log('root:', fs.readdirSync(asar).join(', '))
} catch (error) {
  console.log('root error:', error.message)
}
const candidates = [
  'dsh\\lib\\bin.js',
  'dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
  'node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
  'dsh\\package.json',
  'dsh\\node_modules\\@deepseek-ai\\dsh\\package.json',
]
for (const rel of candidates) {
  try {
    fs.accessSync(asar + '\\' + rel)
    console.log('FOUND', rel)
  } catch {
    console.log('missing', rel)
  }
}
