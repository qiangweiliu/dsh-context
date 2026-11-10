/**
 * 浏览器半侧的**行为级**测试：真正调用面板组件，而不是匹配源码字符串。
 *
 * 为什么要它：0.24.0 曾在 CtxPanel 里把 `analyticsLimit` 写在 `const budget` 之前，
 * 触发 TDZ ReferenceError，面板每次渲染都整块变空；static/smoke 只做源码断言，
 * 全绿也发现不了。这里用一个最小 React mock 直接执行组件函数。
 *
 * 覆盖：
 *   1. 四个 tab 都能完成一次渲染（TDZ / 未定义变量 / 提前 return 都会抛错）
 *   2. tablist / tab / tabpanel 的 role、id、aria-controls/labelledby、roving tabindex
 *   3. ←/→/Home/End 键盘切换
 *   4. 卡片级 ErrorBoundary：正常路径透传 children、失败降级、重试重置
 *
 * 运行：node test/render.mjs
 */
import { readFileSync } from 'node:fs'
import { loadClient } from './client-harness.mjs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

/** 最小 React：记录 hook 序号，第 N 次 useState 可注入初值；effect 不执行（避免真的 fetch）。 */
function makeReact(initialStates = {}) {
  const states = new Map()
  const refs = new Map()
  let cursor = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } }),
    Fragment: Symbol('Fragment'),
    Component: class Component {
      constructor(props) {
        this.props = props || {}
        this.state = {}
      }
      setState(patch) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) }
      }
    },
    useState(init) {
      const index = cursor++
      if (!states.has(index)) states.set(index, Object.prototype.hasOwnProperty.call(initialStates, index) ? initialStates[index] : typeof init === 'function' ? init() : init)
      return [states.get(index), (next) => states.set(index, typeof next === 'function' ? next(states.get(index)) : next)]
    },
    useRef(value) {
      const index = cursor++
      if (!refs.has(index)) refs.set(index, { current: value })
      return refs.get(index)
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useId: () => ':r0:',
    useEffect: () => {},
    useLayoutEffect: () => {},
  }
}

const readyStatus = {
  phase: 'ready',
  data: {
    version: '0.25.0',
    budget: { tokens: 128000, warnAt: 0.75, errorAt: 0.9, triggerAt: 0.9, targetAt: 0.6, analyticsLimit: 40 },
    control: { active: true, mode: 'idle', log: [] },
    measurements: [],
    onboarding: { completed: true, dismissed: false, budgetConfirmed: true },
    health: { healthy: true, checks: [] },
    configEditable: false,
    pricing: null,
    profile: 'web',
  },
}

/** 载入 client.js 并取回 settings.section 的组件。 */
function panelFor(tab, extraStates = {}) {
  const react = makeReact({ 0: readyStatus, 1: tab, ...extraStates })
  const loaded = loadClient(source, { react })
  for (const inject of loaded.slotInjects) inject.callback()
  const registration = loaded.slotRegistrations.find((entry) => entry.definition?.name === 'settings.section')
  return { panel: registration?.component, loaded }
}

const collect = (node, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  out.push(node)
  collect(node.props?.children, out)
  return out
}
const findAll = (node, predicate) => collect(node).filter((element) => element && element.props && predicate(element))

// 词典里的降级文案带 {message} 占位符，组件自己替换；这里让 t 保留占位符。
const t = (key) => (key === 'cardFailed' ? 'cardFailed {message}' : key)
const tabs = ['overview', 'trend', 'events', 'settings']
const trees = {}
for (const tab of tabs) {
  try {
    const { panel } = panelFor(tab)
    trees[tab] = panel({ t, title: 'Context' })
    check(`tab ${tab} 渲染不抛错`, Boolean(trees[tab] && trees[tab].props && trees[tab].props['data-embodiment-panel'] === '1'), JSON.stringify(Object.keys(trees[tab]?.props || {})))
  } catch (error) {
    trees[tab] = null
    check(`tab ${tab} 渲染不抛错`, false, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  }
}

const overview = trees.overview
if (overview) {
  const tablist = findAll(overview, (element) => element.props.role === 'tablist')
  check('只有一组 tablist 且带 aria-label', tablist.length === 1 && typeof tablist[0].props['aria-label'] === 'string', tablist.map((element) => element.props['aria-label']))
  const tabElements = findAll(overview, (element) => element.props.role === 'tab')
  check('4 个 tab 都带 id/aria-controls/aria-selected', tabElements.length === 4 && tabElements.every((element) => typeof element.props.id === 'string' && typeof element.props['aria-controls'] === 'string' && ['true', 'false'].includes(element.props['aria-selected'])), tabElements.map((element) => element.props.id))
  const panels = findAll(overview, (element) => element.props.role === 'tabpanel')
  check('4 个 tabpanel，非当前 tab 为 hidden 占位', panels.length === 4 && panels.filter((element) => element.props.hidden).length === 3, panels.map((element) => Boolean(element.props.hidden)))
  check('tabpanel 的 aria-labelledby 指向对应 tab', panels.every((panel) => tabElements.some((element) => element.props.id === panel.props['aria-labelledby'] && element.props['aria-controls'] === panel.props.id)))
  check('roving tabindex：只有当前 tab 是 0', tabElements.filter((element) => element.props.tabIndex === 0).length === 1 && tabElements.filter((element) => element.props.tabIndex === -1).length === 3, tabElements.map((element) => element.props.tabIndex))
  check('当前 tab 为 aria-selected=true', tabElements[0].props['aria-selected'] === 'true' && tabElements.slice(1).every((element) => element.props['aria-selected'] === 'false'))
  check('id 用宿主 useId 前缀，避免两个面板实例撞 id', /^r0[-_]/u.test(String(tabElements[0].props.id)) || String(tabElements[0].props.id).startsWith('r0'), tabElements[0].props.id)

  const onKeyDown = tablist[0].props.onKeyDown
  const focused = []
  const buttons = tabElements.map((element, index) => ({ id: element.props.id, focus: () => focused.push(index) }))
  const press = (key) => {
    let prevented = false
    onKeyDown({ key, preventDefault: () => { prevented = true }, currentTarget: { querySelectorAll: () => buttons } })
    return { prevented, focused: focused[focused.length - 1] }
  }
  const right = press('ArrowRight')
  check('ArrowRight 焦点到下一个 tab 并阻止默认', right.focused === 1 && right.prevented === true, right)
  const left = press('ArrowLeft')
  check('ArrowLeft 从头循环到最后一个 tab', left.focused === 3, left)
  check('End 跳到最后一个 tab', press('End').focused === 3)
  check('Home 跳到第一个 tab', press('Home').focused === 0)
  let untouched = true
  try {
    press('Enter')
  } catch {
    untouched = false
  }
  check('其它按键不处理也不抛错', untouched)
}

// 卡片级错误边界
{
  const { panel } = panelFor('settings')
  const tree = panel({ t, title: 'Context' })
  const boundaryTypes = [...new Set(findAll(tree, (element) => typeof element.type === 'function' && element.type.prototype && typeof element.type.prototype.render === 'function').map((element) => element.type))]
  check('设置页存在卡片级边界（>=8 处）', boundaryTypes.length >= 1 && findAll(tree, (element) => boundaryTypes.includes(element.type)).length >= 8, boundaryTypes.length)
  const Boundary = boundaryTypes[0]
  if (Boundary) {
    const normal = new Boundary({ t, children: { type: 'span', props: {} } })
    check('边界正常路径直接透传 children', normal.render() === normal.props.children)
    const derived = Boundary.getDerivedStateFromError(new Error('boom'))
    check('getDerivedStateFromError 记录失败与消息', derived.failed === true && derived.message === 'boom', derived)
    normal.state = derived
    const fallback = normal.render()
    check('降级提示是纯文本且带重试按钮', fallback?.props?.['data-embodiment-card-error'] === '1' && fallback?.props?.children?.[1]?.props?.['data-embodiment-card-retry'] === '1' && !('dangerouslySetInnerHTML' in (fallback?.props || {})), JSON.stringify(Object.keys(fallback?.props || {})))
    check('降级文案包含原始消息', String(fallback?.props?.children?.[0]?.props?.children ?? '').includes('boom'), fallback?.props?.children?.[0]?.props?.children)
    fallback?.props?.children?.[1]?.props?.onClick?.()
    check('点击重试重置边界状态', normal.state.failed === false && normal.state.message === '')
    check('非 Error 异常也能显示', Boundary.getDerivedStateFromError('plain-text').message === 'plain-text')
  }
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[render] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[render] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exitCode = 1
}
