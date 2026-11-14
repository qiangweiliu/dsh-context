/**
 * 防漂移：client.js 必须是 client-src/ 片段的拼接结果。
 *
 * 为什么需要：改了 client-src 却忘了跑 `npm run build:client` 时，宿主加载的仍是旧代码，
 * 表现就是「改了没生效」——比编译错误更难查。这里直接比对字节，并在 CI 里跑。
 *
 * 运行：node test/client-build.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORDER, buildClient } from '../scripts/build-client.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const onDisk = readFileSync(join(root, 'client.js'), 'utf8')
const rebuilt = buildClient(root)

check('client-src 片段齐全且顺序可拼', rebuilt.length > 0, rebuilt.length)
check('client.js 与 client-src 拼接结果一致（不需要重新构建）', rebuilt === onDisk, { onDisk: onDisk.length, rebuilt: rebuilt.length })

// 片段目录里出现未登记文件，通常是新增片段忘了加进 ORDER。
const files = readdirSync(join(root, 'client-src')).filter((name) => name.endsWith('.js')).sort()
const missing = ORDER.filter((name) => !files.includes(name))
const unregistered = files.filter((name) => !ORDER.includes(name))
check('ORDER 中的片段文件都存在', missing.length === 0, missing)
check('client-src 没有未登记进 ORDER 的片段', unregistered.length === 0, unregistered)

// 构建产物自检：入口结构完整。
check('client.js 仍以 __ModuleLoader__ 注册', onDisk.includes('__ModuleLoader__') && onDisk.includes('exports.apply = apply'))
check('client.js 含 CLIENT_VERSION', /CLIENT_VERSION = '\d+\.\d+\.\d+'/.test(onDisk))

const failed = checks.filter((item) => !item.ok)
console.log(`\n[client-build] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[client-build] 失败项：' + failed.map((item) => item.name).join(' | '))
  console.error('[client-build] 提示：改过 client-src 后请运行 npm run build:client')
  process.exitCode = 1
}
