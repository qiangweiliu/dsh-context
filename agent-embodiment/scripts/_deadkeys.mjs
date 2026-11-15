import { readFileSync } from 'node:fs'

const source = readFileSync('client-src/10-locale.js', 'utf8')
// 从词典里取出 en 段的所有键
const enBlock = source.slice(source.indexOf('const en = {'), source.indexOf('const zh = {'))
const keys = [...enBlock.matchAll(/^\s{6}([A-Za-z0-9_]+):/gmu)].map((match) => match[1])

const whole = ['00-head.js', '10-locale.js', '20-styles.js', '30-core.js', '40-dock.js', '45-inventory.js', '50-sections.js', '55-charts.js', '60-scaffold.js', '70-panel.js', '90-apply.js']
  .map((file) => readFileSync(`client-src/${file}`, 'utf8'))
  .join('\n')

const literal = new Set([...whole.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/gu)].map((match) => match[1]))
const dynamic = [...whole.matchAll(/\bt\(([^)]*)\)/gu)].filter((match) => !/^'[A-Za-z0-9_]+'$/u.test(match[1].trim())).map((match) => match[1].trim().slice(0, 60))

const unreferenced = keys.filter((key) => !literal.has(key))
console.log(`词典键 ${keys.length} 个，字面量引用 ${literal.size} 个，未引用 ${unreferenced.length} 个：`)
console.log(unreferenced.join('\n'))
console.log('\n动态 t(...) 调用（未引用键若出现在这些表达式里就不算死键）：')
console.log([...new Set(dynamic)].join('\n') || '（无）')
