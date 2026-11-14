/**
 * 词典一致性：client.js 里用到的每个 t('key') 都必须在 en 与 zh 里存在，反之也报告死键。
 *
 * 为什么需要：`t` 是运行时函数，键写错不会报错，只会把键名原样显示给用户；
 * 中英任一侧漏键则切换语言时才暴露。这类问题用字符串断言抓不到，用行为测试也不划算，
 * 静态扫描两条词典与调用点最直接。
 *
 * 运行：node test/locale-keys.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

/** 从 `const en = {` / `const zh = {` 里取出键集合（只取第一层缩进 6 空格的键）。 */
function dictionaryKeys(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) return null
  // 从起始位置做花括号配对，避免被内部的 } 提前截断。
  let depth = 0
  let end = -1
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  const body = source.slice(start, end)
  const keys = new Set()
  for (const match of body.matchAll(/^\s{6}([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(match[1])
  return keys
}

const en = dictionaryKeys('en')
const zh = dictionaryKeys('zh')
check('能解析 en 词典', en instanceof Set && en.size > 0, en ? en.size : 'parse failed')
check('能解析 zh 词典', zh instanceof Set && zh.size > 0, zh ? zh.size : 'parse failed')
check('en/zh 键数量一致', Boolean(en && zh && en.size === zh.size), { en: en?.size, zh: zh?.size })

if (en && zh) {
  const missingInZh = [...en].filter((key) => !zh.has(key))
  const missingInEn = [...zh].filter((key) => !en.has(key))
  check('en 的每个键在 zh 都存在', missingInZh.length === 0, missingInZh.slice(0, 10))
  check('zh 的每个键在 en 都存在', missingInEn.length === 0, missingInEn.slice(0, 10))

  // 调用点：t('key') / t("key")
  const used = new Set()
  for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_$]+)'\s*\)/g)) used.add(match[1])
  for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_$]+)"\s*\)/g)) used.add(match[1])

  const unknown = [...used].filter((key) => !en.has(key))
  check('每个 t(key) 调用都在词典里', unknown.length === 0, unknown.slice(0, 10))

  // 死键只做提示（部分键由测试/未来入口使用），不算失败。
  const unused = [...en].filter((key) => !used.has(key))
  console.log(`note - 未被 t('...') 字面量引用的键 ${unused.length} 个（动态键属正常）`)
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[locale-keys] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[locale-keys] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exitCode = 1
}
