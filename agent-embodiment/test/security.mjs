/**
 * 安全回归测试（0.46.0）：把独立审计发现的问题固定成断言。
 *
 * 这些用例全部来自 `docs/security-audit-independent-0.45.md` 的 F1–F5，
 * 每条都先确认「修复前可复现」，再用断言锁住修复后的行为。
 *
 * 运行：node test/security.mjs
 */
import { readFileSync } from 'node:fs'

import { createAnalytics, normalizeRange } from '../analytics.js'
import { isProtectedScaffoldPath } from '../routes-scaffold.js'
import { planScaffold } from '../scaffold.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

// ── F1：MCP env 键不能注入 YAML（也就不能注入 !!js 表达式）──
const evilKey = 'A: !!js process.exit(1)\n        B'
let blocked = false
try {
  planScaffold({ template: 'repo-coder', slug: 'x', mcp: [{ serverName: 's', transport: 'stdio', command: 'node', args: [], env: { [evilKey]: 'v' } }] })
} catch (error) {
  blocked = /is invalid/u.test(String(error?.message))
}
check('F1 恶意 MCP env 键被拒绝', blocked)

const legit = planScaffold({
  template: 'repo-coder',
  slug: 'y',
  mcp: [{ serverName: 's', transport: 'stdio', command: 'node', args: [], env: { MY_TOKEN: '${MY_TOKEN}' } }],
})
const legitPatch = String(legit.files.find((file) => file.path.endsWith('dsh.bundle.patch.yml'))?.content ?? '')
check('F1 合法键与 ${VAR} 引用仍可用', legitPatch.includes('MY_TOKEN') && legitPatch.includes('!!js process.env.MY_TOKEN'))
check('F1 生成的 patch 只有内置常量会带 !!js', (legitPatch.match(/!!js/gu) || []).length === (legitPatch.match(/!!js process\.env\.MY_TOKEN|!!js process\.platform/gu) || []).length)

// ── F2：受保护路径的绕过（大小写 / 设备前缀 / 8.3 / 凭据目录）──
// 路径语义是平台相关的：Windows 的大小写不敏感与 8.3 短名只在 win32 上有意义，
// POSIX 用 /etc、/root、$HOME 这些。CI 在 Linux 上跑，所以按平台分流断言。
const roots = process.platform === 'win32'
  ? { home: 'C:\\Users\\40410', dshHome: 'C:\\Users\\40410\\.dsh' }
  : { home: '/home/tester', dshHome: '/home/tester/.dsh' }

const mustProtect = process.platform === 'win32'
  ? [
    'C:\\Windows\\System32',
    'c:\\windows\\system32',
    'C:\\WINDOWS',
    '\\\\?\\C:\\Windows',
    'c:\\users\\40410\\.ssh',
    'C:\\PROGRA~1',
    'C:\\Users',
    'C:\\Users\\40410\\.dsh\\profiles',
  ]
  : [
    '/etc',
    '/etc/nginx',
    '/root',
    '/home',
    '/home/tester',
    '/home/tester/.ssh',
    '/home/tester/.dsh',
    '/home/tester/.dsh/profiles',
  ]
const mustAllow = process.platform === 'win32'
  ? ['C:\\work\\my-agent', 'C:\\Users\\40410\\work\\agent']
  : ['/home/tester/work/agent', '/tmp/agent-workspace']

for (const path of mustProtect) {
  check(`F2 受保护：${path}`, isProtectedScaffoldPath(path, roots) === true, isProtectedScaffoldPath(path, roots))
}
for (const path of mustAllow) {
  check(`F2 放行：${path}`, isProtectedScaffoldPath(path, roots) === false, isProtectedScaffoldPath(path, roots))
}
// 8.3 短名在任何平台上都应视为不确定路径 → 受保护（win32 上正则命中，POSIX 上按普通路径判定）
check('F2 8.3 短名按不确定路径处理', isProtectedScaffoldPath('C:\\PROGRA~1', roots) === (process.platform === 'win32'), isProtectedScaffoldPath('C:\\PROGRA~1', roots))

// ── F3：analytics 缓存键归一化 + 上界 ──
check('F3 range 白名单归一化', normalizeRange('junk') === '7d' && normalizeRange('30d') === '30d')
const analytics = createAnalytics({
  getSessionQuery: () => ({ listSessions: async () => [] }),
  foldFor: async () => null,
  summarizeFolds: () => ({ sessions: 0, range: { start: 0, days: 7 }, totals: {} }),
  readCompactionLog: () => [],
  getPricing: () => [],
  getLimit: () => 40,
  readWithTimeout: async (task) => task(),
  mapLimit: async (items, _concurrency, task) => Promise.all(items.map((item) => task(item))),
})
for (let index = 0; index < 50; index += 1) {
  await analytics.payload(new URL(`http://127.0.0.1/api/agent-embodiment/status/analytics?range=junk${index}`))
}
check('F3 乱传 range 不会撑爆缓存', analytics.cacheSize() <= 8, analytics.cacheSize())
check('F3 payload 带归一化 rangeKey', (await analytics.payload(new URL('http://127.0.0.1/x?range=bogus')))?.rangeKey === '7d')

// ── F4：提示词文本上限（routes-inventory / routes-session 都设了 32KB）──
const inventorySource = readFileSync(new URL('../routes-inventory.js', import.meta.url), 'utf8')
const sessionSource = readFileSync(new URL('../routes-session.js', import.meta.url), 'utf8')
check('F4 全局提示词文本有 32KB 上限', inventorySource.includes('MAX_PROMPT_TEXT_BYTES = 32 * 1024') && inventorySource.includes('text is too large'))
check('F4 会话提示词文本有 32KB 上限', sessionSource.includes('MAX_SESSION_PROMPT_TEXT_BYTES = 32 * 1024') && sessionSource.includes('text is too large'))

// ── F5：全局工具开关必须走写队列（否则并发写互相覆盖）──
check('F5 全局开关走 queuePromptWrite', /queuePromptWrite\(\(\) => found\.editor/u.test(inventorySource))

// ── F6：原子写带 fsync；F9：猴子补丁可还原 ──
const persistSource = readFileSync(new URL('../persist.js', import.meta.url), 'utf8')
check('F6 atomicWriteFile 带 fsync', persistSource.includes('fsyncSync'))
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
check('F9 configEditor.edit 猴子补丁在 dispose 还原', indexSource.includes('restoreEdit') && indexSource.includes('delete editor.__ctxBackedUp'))

const failed = checks.filter((item) => !item.ok)
console.log(`\n[security] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1
