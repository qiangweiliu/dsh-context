// 解析探针：从「插件真实代码所在路径」出发，检查能否 import 宿主 @deepseek-ai/* 包。
// 用法: node test/resolve-probe.mjs
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'

const anchors = {
  'profile package.json (loader 锚点)': 'C:\\Users\\40410\\.dsh\\profiles\\desktop\\package.json',
  'bloom lib/index.js (link 前的入口)': 'C:\\Users\\40410\\.dsh\\profiles\\desktop\\node_modules\\dsh-bloom-theme\\lib\\index.js',
  'billion-context dist/agent/dsh-native.js': 'C:\\Users\\40410\\.dsh\\profiles\\desktop\\node_modules\\billion-context\\dist\\agent\\dsh-native.js',
  'dshmarket lib/index.js': 'C:\\Users\\40410\\.dsh\\profiles\\desktop\\node_modules\\dshmarket\\lib\\index.js',
  'skeleton index.js (我们插件的真实路径)': 'C:\\Users\\40410\\Desktop\\context\\plugin-skeleton\\index.js',
}

const specs = ['@deepseek-ai/dsh/package.json', '@deepseek-ai/schemastery', '@deepseek-ai/cordis', '@deepseek-ai/dsh-compaction-basic', 'zod']

for (const [label, anchor] of Object.entries(anchors)) {
  let real = anchor
  try { real = realpathSync(anchor) } catch { /* 允许不存在 */ }
  const req = createRequire(real)
  for (const spec of specs) {
    try {
      console.log(`${label} | ${spec} => OK ${req.resolve(spec)}`)
    } catch (error) {
      console.log(`${label} | ${spec} => ${error.code ?? error.name}`)
    }
  }
}
