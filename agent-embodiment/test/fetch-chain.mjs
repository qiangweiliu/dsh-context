/**
 * fetch 链行为回归：真正执行 useStatus / fetchJson 的异步链。
 *
 * 为什么单独一个文件：0.26.0 曾把 useStatus 改用 fetchJson（返回已解析的 JSON 对象），
 * 却忘记删掉旧的 `(response) => { if(!response.ok)…; return response.json() }` 双重解析链，
 * 导致面板在真实浏览器里永远进入 error 态、整块空白。static/render 都抓不到——render 的
 * useEffect 是 no-op，useStatus 的 load() 从未真正跑；static/smoke 只测宿主半侧。
 *
 * 这里用「真正执行 useEffect + mock fetch」让 useStatus 的 fetch 链跑一遍：
 *   1. fetchJson 应把 Response 转成 JSON 对象（payload 有 ok/version 字段）
 *   2. useStatus 应进入 phase:'ready' 且 data 正确（而不是抛 "HTTP undefined" / response.json is not a function）
 *
 * 运行：node test/fetch-chain.mjs
 */
import { readFileSync } from 'node:fs'
import { loadClient } from './client-harness.mjs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

/** 最小 React：useState 按序号注入初值；useEffect 同步执行一次（模拟挂载），触发 load()。 */
function makeReact(initialStates = {}) {
  const states = new Map()
  const refs = new Map()
  let cursor = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } }),
    Fragment: Symbol('Fragment'),
    Component: class Component {
      constructor(props) { this.props = props || {}; this.state = {} }
      setState(patch) { this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) } }
    },
    useState(init) {
      const index = cursor++
      if (!states.has(index)) states.set(index, Object.prototype.hasOwnProperty.call(initialStates, index) ? initialStates[index] : typeof init === 'function' ? init() : init)
      return [states.get(index), (next) => states.set(index, typeof next === 'function' ? next(states.get(index)) : next)]
    },
    useRef(value) { const index = cursor++; if (!refs.has(index)) refs.set(index, { current: value }); return refs.get(index) },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useId: () => ':r0:',
    // 真正执行一次 effect，让 useStatus 的 load() 跑起来（其余 effect 如 visibilitychange 监听对结果无影响）。
    useEffect: (fn) => { try { const dispose = fn(); if (typeof dispose === 'function') return } catch {} },
    useLayoutEffect: () => {},
  }
}

/** mock fetch：返回带 ok + json() 的 Response 形状；记录每个请求的 path。 */
function mockFetch(routes) {
  const calls = []
  const fakeFetch = async (path, options) => {
    calls.push({ path, method: options?.method || 'GET' })
    const route = routes[path]
    if (!route) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
    return { ok: route.ok !== false, status: route.status ?? 200, json: async () => route.body }
  }
  return { fakeFetch, calls }
}

const readyStatus = {
  phase: 'ready',
  data: {
    version: '0.26.0',
    budget: { tokens: 128000, warnAt: 0.75, errorAt: 0.9, triggerAt: 0.9, targetAt: 0.6, analyticsLimit: 40 },
    control: { active: true, mode: 'idle', log: [] },
    measurements: [],
    onboarding: { completed: true, dismissed: true, budgetConfirmed: true },
    health: { healthy: true, checks: [] },
    configEditable: false,
    pricing: null,
    profile: 'desktop',
  },
}

// 各子路由返回的最小合理 JSON；/status 是 useStatus 的目标。
const routes = {
  '/api/agent-embodiment/status': { body: { ok: true, version: '0.26.0', ...readyStatus.data } },
}
// 其余 useLive 拉取的路径都返回空 ok，避免面板后续渲染抛错（本次断言只看 useStatus 结果）。
for (const suffix of ['/live', '/analytics', '/insights', '/inventory', '/session-detail']) {
  routes[`/api/agent-embodiment/status${suffix}`] = { body: { ok: true, sessions: [], insights: [], daily: [], requests: [], compactions: [], timeline: [] } }
}

const { fakeFetch, calls } = mockFetch(routes)
const originalFetch = globalThis.fetch
globalThis.fetch = fakeFetch
try {
  const react = makeReact({ 0: readyStatus, 1: 'overview' })
  const loaded = loadClient(source, { react })
  for (const inject of loaded.slotInjects) inject.callback()
  const registration = loaded.slotRegistrations.find((entry) => entry.definition?.name === 'settings.section')
  const panel = registration?.component
  const t = (key) => key
  let tree = null
  let thrown = null
  try {
    tree = panel({ t, title: 'Context' })
  } catch (error) {
    thrown = error
  }

  // 关键断言：useStatus 必须进入 ready（data.phase === 'ready'），而不是 error。
  // 面板树里 data-embodiment-version 只会在 data.version 存在时渲染，等价于 useStatus 成功。
  const collect = (node, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { for (const child of node) collect(child, out); return out }
    out.push(node)
    collect(node.props?.children, out)
    return out
  }
  const els = tree ? collect(tree) : []
  const versionChip = els.find((element) => element.props?.['data-embodiment-version'])

  check('渲染不抛错', thrown === null, thrown ? String(thrown.message) : null)
  check('useStatus 进入 ready（版本 chip 渲染 = data.version 存在）', Boolean(versionChip), versionChip ? versionChip.props['data-embodiment-version'] : 'no version chip')
  check('fetchJson 实际发起了 /status 请求', calls.some((call) => call.path === '/api/agent-embodiment/status'), calls.map((call) => call.path))
} finally {
  globalThis.fetch = originalFetch
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[fetch-chain] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[fetch-chain] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exitCode = 1
}
