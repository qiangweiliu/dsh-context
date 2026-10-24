#!/usr/bin/env node
/**
 * 等待 awesome-dsh-plugin PR 合并，并在合并后确认官方 catalog 是否收录。
 *
 *   node scripts/watch-market-pr.mjs [--pr 9029] [--interval 300] [--hours 24]
 *
 * 输出到 stdout；合并且 catalog 出现条目时退出 0，超时退出 1。
 * 只使用公开 GitHub API / catalog，不需要 token。
 */
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const PR = Number(flag('pr', '9029'))
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin'
const INTERVAL_MS = Number(flag('interval', '300')) * 1000
const HOURS = Number(flag('hours', '24'))
const CATALOG = 'https://awesome-dsh-plugin.com/plugins.json'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

const deadline = Date.now() + HOURS * 3600_000
for (let attempt = 1; Date.now() < deadline; attempt += 1) {
  try {
    const pr = await getJson(`https://api.github.com/repos/${REPO}/pulls/${PR}`)
    console.log(`${new Date().toISOString()} #${PR} state=${pr.state} merged=${pr.merged} mergeable=${pr.mergeable_state}`)
    if (pr.merged) {
      for (let poll = 1; poll <= 24; poll += 1) {
        const catalog = await getJson(CATALOG)
        const hit = (catalog.plugins || []).find((entry) => typeof entry?.url === 'string' && entry.url.includes('/agent-embodiment'))
        console.log(`${new Date().toISOString()} catalog poll ${poll}: updated=${catalog.updated} hit=${hit ? hit.name : 'none'}`)
        if (hit) {
          console.log(`CATALOG_OK ${hit.name} ${hit.url}`)
          process.exit(0)
        }
        await sleep(INTERVAL_MS)
      }
      console.log('MERGED_BUT_CATALOG_PENDING')
      process.exit(0)
    }
  } catch (error) {
    console.log(`${new Date().toISOString()} watch error: ${error instanceof Error ? error.message : String(error)}`)
  }
  await sleep(INTERVAL_MS)
}
console.log('WATCH_TIMEOUT')
process.exit(1)
