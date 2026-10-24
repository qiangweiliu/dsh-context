#!/usr/bin/env node
/**
 * 本地 dshmarket 镜像：在公开收录 PR 合并前，让当前机器上的 dshmarket 能搜到
 * agent-embodiment，并给出一键安装命令。
 *
 * 用法：
 *   node scripts/local-market-mirror.mjs --port 8765
 *   # 另开终端启动 DSH（需要重启进程才能读到环境变量）：
 *   DSHM_REGISTRY_URL=http://127.0.0.1:8765/plugins.json dsh web
 *
 * 说明：
 *   - 只读公开 catalog，替换 qiangweiliu/dsh-context 的旧条目为本仓库新条目；
 *   - 不修改任何 profile / 全局配置；
 *   - 不是公开收录，PR 合并后应去掉 DSHM_REGISTRY_URL，回到官方 catalog。
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const PORT = Number(flag('port', '8765'))
const HOST = flag('host', '127.0.0.1')
const SOURCE = flag('source', 'https://awesome-dsh-plugin.com/plugins.json')
const SNAPSHOT = flag('snapshot', '')
const CATALOG_URL = `http://${HOST}:${PORT}/plugins.json`

async function loadCatalog() {
  if (SNAPSHOT) return JSON.parse(readFileSync(resolve(SNAPSHOT), 'utf8'))
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`catalog fetch failed: HTTP ${response.status}`)
  return response.json()
}

function patchCatalog(catalog) {
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : []
  const kept = plugins.filter((entry) => !(
    typeof entry?.url === 'string'
    && entry.url.includes('github.com/qiangweiliu/dsh-context')
  ))
  const entry = {
    name: 'dsh-context#agent-embodiment',
    owner: 'qiangweiliu',
    url: 'https://github.com/qiangweiliu/dsh-context/tree/main/agent-embodiment',
    page: 'https://awesome-dsh-plugin.com/p/qiangweiliu/dsh-context--agent-embodiment/',
    category: 'session',
    description: {
      en: 'Context observability and control for DeepSeek Harness: cross-session token analytics, session-level budget/prompt/tool controls, and optional agent scaffolds. It reuses the official tokenMeter, compaction, systemPrompt, and tools.restrict seams; monitoring is read-only.',
      zh: '为 DeepSeek Harness 提供上下文可观测性与控制：跨会话 token 分析、会话级预算/提示词/工具控制，以及可选的 Agent 脚手架。复用官方 tokenMeter、compaction、systemPrompt、tools.restrict seam；监控只读。',
    },
    npm: null,
    version: null,
    stars: 0,
    downloads: null,
    downloadsStart: null,
    downloadsEnd: null,
    downloadsCheckedAt: null,
    install: 'dsh plugin --profile web add github:qiangweiliu/dsh-context#path:/agent-embodiment',
    added: new Date().toISOString().slice(0, 10),
  }
  return {
    ...catalog,
    updated: new Date().toISOString().slice(0, 10),
    count: kept.length + 1,
    plugins: [entry, ...kept],
  }
}

const catalog = patchCatalog(await loadCatalog())
const body = `${JSON.stringify(catalog)}\n`

const server = createServer((request, response) => {
  if (request.method !== 'GET' || !['/plugins.json', '/'].includes(request.url?.split('?')[0] ?? '')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
})

server.listen(PORT, HOST, () => {
  console.log(`[market-mirror] serving ${CATALOG_URL}`)
  console.log(`[market-mirror] entries: ${catalog.plugins.length}; agent-embodiment injected`)
  console.log('[market-mirror] restart DSH with:')
  console.log(`  DSHM_REGISTRY_URL=${CATALOG_URL} dsh web`)
  console.log('[market-mirror] after the awesome-dsh-plugin PR merges, remove DSHM_REGISTRY_URL')
})
