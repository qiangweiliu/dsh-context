/**
 * 等待运行中的 DSH Web 实例热加载 ctx-mon-and-con。
 *
 * 用法：node scripts/wait-for-ctx-plugin.mjs <带 token 的页面 URL> [超时秒数]
 * 例：  node scripts/wait-for-ctx-plugin.mjs 'http://127.0.0.1:3080/?token=...' 15
 *
 * 先用 token 换登录 cookie，再轮询插件的状态路由。退出码 0 = 已热加载，
 * 1 = 超时（通常刷新页面即可；替换已安装包时 DSH 仍要求重启进程）。
 */
import { setTimeout as delay } from 'node:timers/promises'

const urlArg = process.argv[2]
const timeoutSeconds = Number(process.argv[3] || '15')
if (!urlArg) {
  console.error('usage: node scripts/wait-for-ctx-plugin.mjs <url-with-token> [timeoutSeconds]')
  process.exit(2)
}

const pageUrl = new URL(urlArg)
const token = pageUrl.searchParams.get('token')
if (!token) {
  console.error('wait-for-ctx-plugin: URL 缺少 token 查询参数')
  process.exit(2)
}

const rootUrl = new URL('/', pageUrl)
rootUrl.searchParams.set('token', token)
let cookie
try {
  const auth = await fetch(rootUrl, { redirect: 'manual' })
  cookie = auth.headers.get('set-cookie')?.split(';')[0]
} catch (error) {
  console.error(`wait-for-ctx-plugin: 无法连接 ${rootUrl.origin}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (!cookie) {
  console.error('wait-for-ctx-plugin: 登录响应没有 set-cookie，无法轮询状态路由')
  process.exit(1)
}

const statusUrl = new URL('/api/ctx-mon-and-con/status', pageUrl)
const startedAt = Date.now()
const deadline = startedAt + Math.max(1, timeoutSeconds) * 1000
while (Date.now() < deadline) {
  try {
    const response = await fetch(statusUrl, { headers: { cookie } })
    if (response.ok) {
      const data = await response.json()
      console.log(`hot-loaded: ${data.plugin ?? 'ctx-mon-and-con'}@${data.version ?? '?'} (${Date.now() - startedAt}ms)`)
      process.exit(0)
    }
  } catch {}
  await delay(500)
}

console.error(`timeout: 插件状态路由在 ${timeoutSeconds}s 内未就绪；刷新页面即可，若仍不出现再检查 profile/HMR`)
process.exit(1)
