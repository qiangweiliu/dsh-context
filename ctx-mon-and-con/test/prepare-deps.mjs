/**
 * 从 DSH 的 app.asar 解出跑 test/smoke.mjs 所需的最小运行时：
 * @deepseek-ai/cordis（+ 它的依赖 @deepseek-ai/cosmokit）。
 *
 * 交付的骨架**不携带**这些第三方源码副本，所以首次跑集成冒烟测试前执行一次：
 *   node test/prepare-deps.mjs
 * 可用环境变量 DSH_ASAR 覆盖 app.asar 路径；产物写入 test/deps/（可随时删除）。
 *
 * 只读 asar + 写入 test/deps，不启动 DSH、不跑 pnpm。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASAR =
  process.env.DSH_ASAR ??
  'C:\\Users\\40410\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const OUT = fileURLToPath(new URL('./deps/', import.meta.url))
const WANTED = /^dsh\/node_modules\/@deepseek-ai\/(cordis|cosmokit)\//u

if (!existsSync(ASAR)) {
  console.error(`[prepare-deps] 找不到 app.asar：${ASAR}；可用 DSH_ASAR 环境变量指定。`)
  process.exit(2)
}

// asar 容器格式：0..3 = 4，4..7 = header 大小，8..8+headerSize = header；
// header 内部 0..3 = 4，4..7 = JSON 字节数，8.. = JSON；文件内容从 8+headerSize 开始。
const buffer = readFileSync(ASAR)
const headerSize = buffer.readUInt32LE(4)
const header = buffer.subarray(8, 8 + headerSize)
const jsonLength = header.readUInt32LE(4)
const tree = JSON.parse(header.toString('utf8', 8, 8 + jsonLength))
const dataStart = 8 + headerSize

const extracted = []
function walk(node, prefix) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, prefix ? `${prefix}/${name}` : name)
    return
  }
  if (!WANTED.test(prefix)) return
  if (node.link) throw new Error(`[prepare-deps] 不处理 asar 符号链接：${prefix}`)
  const destination = join(OUT, prefix)
  mkdirSync(dirname(destination), { recursive: true })
  const start = dataStart + Number(node.offset)
  writeFileSync(destination, buffer.subarray(start, start + node.size))
  extracted.push(prefix)
}

walk(tree, '')
console.log(`[prepare-deps] 解出 ${extracted.length} 个文件到 ${OUT}`)
const entry = join(OUT, 'dsh/node_modules/@deepseek-ai/cordis/lib/index.js')
if (!existsSync(entry)) {
  console.error(`[prepare-deps] 解包结果不完整：缺少 ${entry}`)
  process.exit(1)
}
