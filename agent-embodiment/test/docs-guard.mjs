/**
 * 文档与代码常量一致性守卫。
 *
 * 为什么需要：0.34.0 复核发现 15 处文档滞后（其中包括「没有 connection 不拦截」这类
 * 实质性错误）、CLAUDE 概览里的版本号长期停在 0.29.0。这些都是「同一事实抄了多份」，
 * 没有自动守卫就只能靠人眼。这里只断言**关键常量**，不查章节结构，避免噪声。
 *
 * 运行：node test/docs-guard.mjs
 */
import { readFileSync } from 'node:fs'

import { FALLBACK_BUDGET_TOKENS } from '../state.js'
import { PRICING_UPDATED_AT } from '../metrics.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const readRoot = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const manifest = JSON.parse(read('../package.json'))
const version = manifest.version
const clientBundle = read('../client.js')
const clientHead = read('../client-src/00-head.js')
const index = read('../index.js')
const implementation = read('../docs/IMPLEMENTATION.md')
const limitations = read('../docs/LIMITATIONS.md')
const permissions = read('../PERMISSIONS.md')
const readme = read('../README.md')
const rootReadme = readRoot('README.md')
const claude = readRoot('CLAUDE.md')

// 1) 版本号：package.json 是唯一真相，其余都是副本。
const bundleVersion = (clientBundle.match(/const CLIENT_VERSION = '([^']+)'/u) || [])[1]
const headVersion = (clientHead.match(/const CLIENT_VERSION = '([^']+)'/u) || [])[1]
check('client.js 的 CLIENT_VERSION 与 package.json 一致', bundleVersion === version, { version, bundleVersion })
check('client-src/00-head.js 的 CLIENT_VERSION 与 package.json 一致', headVersion === version, { version, headVersion })
check('agent README 提到当前版本', readme.includes(version), version)
check('根 README 提到当前版本', rootReadme.includes(version), version)
check('IMPLEMENTATION 提到当前版本', implementation.includes(version), version)
const claudeVersion = (claude.match(/当前 `package\.json` 版本 `([\d.]+)`/u) || [])[1]
check('CLAUDE 项目概览的版本号与 package.json 一致', claudeVersion === version, { version, claudeVersion })

// 1.1) 另外三份「抄了版本号」的文档：以前全靠手工同步，漏过。
const changelog = read('../CHANGELOG.md')
const releasePlan = read('../docs/RELEASE-PLAN.md')
const evidence = read('../docs/EVIDENCE.md')

// Keep a Changelog 的约定是「最新条目在最上面」，所以顶部那一条必须是当前版本。
const changelogTop = (changelog.match(/^## \[([\d.]+)\]/mu) || [])[1]
check('CHANGELOG 顶部条目的版本与 package.json 一致', changelogTop === version, { version, changelogTop })

// 路线图表格里标着「当前版本」的那一行，其版本区间必须包含当前版本 —— 否则就是
// 「文档说当前是 X，代码已经是 Y」这种最误导人的滞后。
const currentRow = releasePlan.split('\n').find((line) => line.includes('**当前版本**')) ?? ''
const rowVersions = [...currentRow.matchAll(/(\d+\.\d+\.\d+)/gu)].map((match) => match[1])
const coversCurrent = rowVersions.length > 0 && (() => {
  const toNumber = (text) => text.split('.').map(Number)
  const [low, high] = rowVersions.length > 1 ? [rowVersions[0], rowVersions[1]] : [rowVersions[0], rowVersions[0]]
  const current = toNumber(version)
  const compare = (left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index]
    }
    return 0
  }
  return compare(current, toNumber(low)) >= 0 && compare(current, toNumber(high)) <= 0
})()
check('RELEASE-PLAN 标注的「当前版本」覆盖 package.json 版本', coversCurrent, { version, row: currentRow.trim().slice(0, 80), rowVersions })

check('EVIDENCE 记录了当前版本', evidence.includes(version), version)

// 2) 预算回退值：代码里只有一处定义，文档必须写同一个数字。
const budgetText = String(FALLBACK_BUDGET_TOKENS)
check('LIMITATIONS 记录的回退预算与 state.js 一致', limitations.includes(budgetText), { budgetText })
check('CLAUDE 记录的回退预算与 state.js 一致', claude.includes(budgetText), { budgetText })

// 3) 价格表抓取日期：metrics 是真相，IMPLEMENTATION 要跟着。
check('IMPLEMENTATION 记录的价格表日期与 metrics 一致', implementation.includes(PRICING_UPDATED_AT), PRICING_UPDATED_AT)

// 4) 路由清单：index.js 注册的每条路由都要在 IMPLEMENTATION 里出现。
const routes = [...index.matchAll(/server\.register\(\{ kind: 'exact', path: `\$\{STATUS_PATH\}(\/[\w/-]*)`/gu)].map((match) => match[1])
const missingRoutes = routes.filter((path) => !implementation.includes(path))
check('IMPLEMENTATION 覆盖全部注册路由', routes.length >= 20 && missingRoutes.length === 0, { total: routes.length, missing: missingRoutes })

// 5) 兼容矩阵：package.json 声明的每个 dshRelease 都要在 PERMISSIONS 里出现。
const releases = Object.keys(manifest?.dsh?.compatibility?.dshReleases || {})
const missingReleases = releases.filter((name) => !permissions.includes(name))
check('PERMISSIONS 覆盖全部 dshReleases', releases.length > 0 && missingReleases.length === 0, { total: releases.length, missing: missingReleases })

// 6) 不带任何 npm 运行时依赖（这条在 static.mjs 也有，这里再保一次防止守卫被绕过）。
check('无 runtime dependencies', !manifest.dependencies || Object.keys(manifest.dependencies).length === 0, manifest.dependencies)

const failed = checks.filter((item) => !item.ok)
console.log(`\n[docs-guard] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of checks) {
  if (item.ok) continue
  console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
}
if (failed.length > 0) {
  console.error(`[docs-guard] 失败项：${failed.map((item) => item.name).join(' | ')}`)
  process.exitCode = 1
}
