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

/**
 * 最小 React：记录 hook 序号，第 N 次 useState 可注入初值；effect 不执行（避免真的 fetch）。
 *
 * hook 状态**按组件隔离**：真实 React 每个组件实例各有一份 hook 链表，序号从 0 起；
 * 这里用 `__enterComponent(name)` 模拟。不隔离时，卡片（如 SkillsCard）的 useState
 * 序号会被面板里前面的 hook 推高，想给卡片注入某个初值就得数出面板用了多少个 hook——
 * 一改面板结构就失效。
 *
 * @param {Record<number, unknown>} initialStates - 顶层组件（CtxPanel）的状态初值。
 * @param {Record<string, Record<number, unknown>>} componentStates - 按组件名注入的初值，
 *   例如 `{ SkillsCard: { 3: 'delta' } }` 表示 SkillsCard 第 4 个 useState 初值为 'delta'。
 */
function makeReact(initialStates = {}, componentStates = {}) {
  const scopes = new Map()
  const current = { name: null, stack: [] }
  const scopeFor = (name) => {
    let scope = scopes.get(name)
    if (!scope) {
      scope = { states: new Map(), refs: new Map(), cursor: 0 }
      scopes.set(name, scope)
    }
    return scope
  }
  const scopeName = () => current.name ?? '__root'
  const injectedFor = (name) => (name === '__root' ? initialStates : componentStates[name] ?? {})
  return {
    /**
     * 进出组件：`renderDeep` 在调用组件函数前后调用，模拟 React 的「当前渲染组件」。
     * 每次进入都把该组件的游标归零（一次渲染从第一个 hook 开始）。
     */
    __enterComponent: (name) => {
      current.stack.push(current.name)
      current.name = name ?? 'anonymous'
      scopeFor(current.name).cursor = 0
    },
    __exitComponent: () => {
      current.name = current.stack.length > 0 ? current.stack.pop() : null
    },
    /** 看看某个组件当前的 hook 状态（调试/断言用）。 */
    __scopeOf: (name) => scopes.get(name) ?? null,
    __componentStates: componentStates,
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
      const name = scopeName()
      const scope = scopeFor(name)
      const index = scope.cursor++
      if (!scope.states.has(index)) {
        const injected = injectedFor(name)
        scope.states.set(index, Object.prototype.hasOwnProperty.call(injected, index) ? injected[index] : typeof init === 'function' ? init() : init)
      }
      return [scope.states.get(index), (next) => scope.states.set(index, typeof next === 'function' ? next(scope.states.get(index)) : next)]
    },
    useRef(value) {
      const name = scopeName()
      const scope = scopeFor(name)
      const index = scope.cursor++
      if (!scope.refs.has(index)) scope.refs.set(index, { current: value })
      return scope.refs.get(index)
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useId: () => ':r0:',
    useEffect: () => {},
    useLayoutEffect: () => {},
    /**
     * 重新渲染前必须把 hook 序号归零。
     *
     * 没这一步时，第二次渲染从上次的 cursor 继续，同一个组件的 useState 会落到
     * 新的下标上 —— 读回来的就不是原来那份状态（tab 切了也看不到变化）。
     * 真实 React 按调用顺序而非全局计数来对应 hook，这里就是在模拟那个行为。
     */
    __resetCursor: () => {
      scopeFor(scopeName()).cursor = 0
    },
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

/**
 * 渲染到指定 tab。
 *
 * 产品代码里 tab 是 `CtxPanel` 的第一个 `useState`，测试不能靠注入槽位猜下标；
 * 这里走真实交互：先渲染一次，拿到带 `data-embodiment-tab` 的按钮，调它的 onClick,
 * 再把 cursor 归零重渲染。产品代码零改动。
 */
function renderTab(tab, extraStates = {}) {
  const react = makeReact({ 0: readyStatus, ...extraStates })
  const loaded = loadClient(source, { react })
  for (const inject of loaded.slotInjects) inject.callback()
  const registration = loaded.slotRegistrations.find((entry) => entry.definition?.name === 'settings.section')
  const component = registration?.component
  if (!component) throw new Error('找不到 settings.section 组件')

  const first = component({ t, title: 'Context' })
  if (tab !== 'overview') {
    const button = collect(first).find((element) => element.props && element.props['data-embodiment-tab'] === tab)
    if (!button || typeof button.props.onClick !== 'function') {
      throw new Error(`找不到 tab 按钮：${tab}`)
    }
    button.props.onClick()
  }
  react.__resetCursor()
  return { tree: component({ t, title: 'Context' }), react, loaded, component, states: extraStates }
}

/**
 * 递归渲染子组件。
 *
 * `CtxPanel` 的树里，卡片都是 `h(SkillsCard, {...})` 这样的**组件元素**——它们
 * 只有被 React 调和器调用后才产出 DOM 标记。这个 harness 没有调和器，所以以前只
 * 看得到顶层元素（tab 按钮、tabpanel 壳），卡片内部（`data-embodiment-skills` 之类）
 * 永远看不见，"到不了 Settings 分支"其实是"没渲染子组件"。
 *
 * 这里手动把函数组件与 class 组件（如 `CardBoundary`）各调一次，深度优先展开。
 */
function renderDeep(node, react = null) {
  if (Array.isArray(node)) return node.map((element) => renderDeep(element, react))
  if (!node || typeof node !== 'object') return node
  const type = node.type
  const props = node.props || {}
  if (typeof type === 'function') {
    let rendered
    // 通知 mock 当前渲染的是哪个组件：hook 序号与状态按组件隔离，和真实 React 一致。
    if (react && typeof react.__enterComponent === 'function') react.__enterComponent(type.name)
    try {
      if (type.prototype && typeof type.prototype.render === 'function') {
        const instance = new type(props)
        rendered = instance.render()
      } else {
        rendered = type(props)
      }
    } finally {
      if (react && typeof react.__exitComponent === 'function') react.__exitComponent()
    }
    return renderDeep(rendered, react)
  }
  return { ...node, props: { ...props, children: renderDeep(props.children, react) } }
}

/** 在未深度渲染的原始树里按组件名找元素（用于给卡片注入 props）。 */
function findComponent(node, name) {
  return collect(node).find((element) => typeof element.type === 'function' && element.type.name === name) ?? null
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

// 设置页：已完成/已跳过引导时出现「重新打开设置」入口（此前 onboardingReopen 从未渲染）。
// 注：mock 不执行函数组件，只能断言 body 里存在 OnboardingReopen 这一层，无法穿透到其内部 DOM。
{
  const settingsTree = trees.settings
  if (settingsTree) {
    const reopenBoundary = findAll(settingsTree, (element) => element.props?.key === 'onboarding-reopen' && typeof element.props?.children?.type === 'function' && element.props.children.type.name === 'OnboardingReopen')
    check('设置页挂载 onboarding 重开入口（completed 时）', reopenBoundary.length === 1, reopenBoundary.length)
    const healthBoundary = findAll(settingsTree, (element) => element.props?.key === 'health' && element.props?.children?.type?.name === 'HealthCard')
    check('设置页仍渲染健康卡', healthBoundary.length === 1, healthBoundary.length)
  }
}

// 输入框下方的两个 dock 条目：直接执行注册的组件，断言真实 DOM 标记。
// 这两条原先只断言源码里出现某个字符串（遇到重命名就误报），改成执行组件后更有意义。
{
  const react = makeReact({ 0: readyStatus, 1: 'overview' })
  const loaded = loadClient(source, { react })
  for (const inject of loaded.slotInjects) inject.callback()
  const docks = loaded.slotRegistrations.filter((entry) => entry.definition?.name === 'conversation.composer.dock')
  const usageDock = docks.find((entry) => entry.definition?.id === 'embody-usage')
  const balanceDock = docks.find((entry) => entry.definition?.id === 'embody-balance')
  check('注册了两个 composer.dock 条目（用量 + 余额）', docks.length === 2 && Boolean(usageDock) && Boolean(balanceDock), docks.map((entry) => entry.definition?.id))

  let usageTree = null
  let usageError = null
  try {
    const element = usageDock?.component({ t })
    usageTree = element?.type ? element.type({ ...element.props, t }) : element
  } catch (error) {
    usageError = error
  }
  const usageMarkers = usageTree ? findAll(usageTree, (element) => element.props?.['data-embodiment-dock-percent'] !== undefined) : []
  check('用量 dock 渲染出已用比例标记', usageMarkers.length > 0, usageError ? String(usageError.message) : usageMarkers.length)

  let balanceTree = null
  let balanceError = null
  try {
    const element = balanceDock?.component({ t })
    balanceTree = element?.type ? element.type({ ...element.props, t }) : element
  } catch (error) {
    balanceError = error
  }
  const balanceMarker = balanceTree ? findAll(balanceTree, (element) => element.props?.['data-embodiment-balance'] === '1') : []
  // 没有账号余额扩展、或用户关掉胶囊时，dock 必须整块不渲染（不占位、不留空 span）。
  check('余额 dock 在无账号/未启用时渲染为空', balanceTree === null || balanceMarker.length === 0, balanceError ? String(balanceError.message) : balanceMarker.length)
  check('余额 dock 渲染失败时也不会抛错', balanceError === null, balanceError ? String(balanceError.message) : null)
}

// 模型价格：峰谷两档必须能往返。
// 回归背景：0.27.0 让配置层支持 peak/offPeak，但面板只映射平档，保存一次就把 yml 里配好的峰谷价抹平。
{
  const react = makeReact()
  const loaded = loadClient(source, { react })
  for (const inject of loaded.slotInjects) inject.callback()
  const marker = loaded.window.__agentEmbodiment
  const declaredVersion = source.match(/CLIENT_VERSION\s*=\s*'([^']+)'/u)?.[1]
  check('挂载后在 window 上留下探针，版本与 CLIENT_VERSION 一致', Boolean(marker && declaredVersion && marker.version === declaredVersion), { marker: marker?.version, declaredVersion })
  const helpers = marker?.helpers
  check('探针暴露 pricing helpers', Boolean(helpers && typeof helpers.pricingDraft === 'function' && typeof helpers.pricingPayload === 'function'))
  if (helpers) {
    const sourceRows = [{ match: 'deepseek', input: 1, cacheRead: 2, cacheWrite: 3, output: 4, peak: { input: 5, output: 6 }, offPeak: { input: 7, output: 8 } }]
    const draft = helpers.pricingDraft(sourceRows)
    check('草稿保留峰谷两档', draft[0].peakInput === '5' && draft[0].peakOutput === '6' && draft[0].offPeakInput === '7' && draft[0].offPeakOutput === '8', draft[0])
    const roundTrip = helpers.pricingPayload(draft)
    check(
      '往返后峰谷两档仍在（回归：面板保存曾抹掉峰谷价）',
      roundTrip.incomplete === false && roundTrip.rows[0].peak?.input === 5 && roundTrip.rows[0].peak?.output === 6 && roundTrip.rows[0].offPeak?.input === 7 && roundTrip.rows[0].offPeak?.output === 8,
      roundTrip.rows[0],
    )
    const plain = helpers.pricingPayload(helpers.pricingDraft([{ match: 'x', input: 1, output: 2 }]))
    check('未配峰谷时不写入空档', plain.rows[0].peak === undefined && plain.rows[0].offPeak === undefined, plain.rows[0])
    const half = helpers.pricingPayload([{ match: 'x', input: '1', output: '2', peakInput: '5', peakOutput: '', offPeakInput: '', offPeakOutput: '' }])
    check('峰谷只填一半时报 incomplete 而非静默丢弃', half.incomplete === true && half.rows.length === 0, half)
    const blanked = helpers.pricingPayload([{ match: 'x', input: '1', output: '2', peakInput: '', peakOutput: '', offPeakInput: '', offPeakOutput: '' }])
    check('清空峰谷两档即回到全天同价', blanked.incomplete === false && blanked.rows[0].peak === undefined && blanked.rows[0].offPeak === undefined, blanked.rows[0])
  }
}



// ── Settings 分支：渲染到设置页并用 renderDeep 展开子组件 ──────────────────────
{
  const settingsTree = renderTab('settings').tree
  check('能渲染到 Settings 分支', Boolean(settingsTree), 'renderTab 返回空')

  const skillCard = findComponent(settingsTree, 'SkillsCard')
  check('Settings 里挂了 SkillsCard', Boolean(skillCard))

  const skillsPayload = {
    ok: true,
    via: 'registry',
    scopeApplied: true,
    complete: true,
    cwd: '/w',
    counts: { total: 8, model: 7, user: 8 },
    skills: [
      { name: 'alpha-skill', description: 'from project', source: 'project-agents', path: '/w/.agents/skills/alpha-skill/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'beta-skill', description: 'hidden from model', source: 'project-agents', path: '/w/.agents/skills/beta-skill/SKILL.md', modelInvocable: false, userInvocable: true },
      { name: 'gamma-skill', description: 'user level', source: 'user-agents', path: '/a/gamma/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'delta-skill', description: 'also user', source: 'user-agents', path: '/a/delta/SKILL.md', modelInvocable: true, userInvocable: false },
      { name: 'epsilon-skill', description: 'x', source: 'user-agents', path: '/a/epsilon/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'zeta-skill', description: 'x', source: 'user-dsh', path: '/d/zeta/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'eta-skill', description: 'x', source: 'user-dsh', path: '/d/eta/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'theta-skill', description: 'x', source: 'user-dsh', path: '/d/theta/SKILL.md', modelInvocable: true, userInvocable: true },
    ],
  }

  if (skillCard) {
    // 直接给卡片喂 props，绕开 hook 槽位猜测——测的是卡片真正的输入契约。
    const rendered = renderDeep({
      ...skillCard,
      props: { ...skillCard.props, data: skillsPayload, loading: false, error: null, reload: () => {} },
    })
    const nodes = collect(rendered)
    const groups = nodes.filter((element) => typeof element.props?.['data-embodiment-skill-group'] === 'string')
    check('技能按来源分组（3 组）', groups.length === 3, groups.map((element) => element.props['data-embodiment-skill-group']).join(','))
    check('分组标题带组内数量', groups.every((element) => /\u00b7 \d+$/u.test(String(element.props.children))), groups.map((element) => String(element.props.children)).join(' | '))
    const rows = nodes.filter((element) => typeof element.props?.['data-embodiment-skill'] === 'string')
    check('8 个技能各一行', rows.length === 8, rows.length)
    const copies = nodes.filter((element) => typeof element.props?.['data-embodiment-skill-copy'] === 'string')
    check('每行有复制路径按钮', copies.length === 8, copies.length)
    const toggles = nodes.filter((element) => typeof element.props?.['data-embodiment-skill-toggle'] === 'string')
    check('每行有查看按钮', toggles.length === 8, toggles.length)
    const search = nodes.filter((element) => element.props?.['data-embodiment-skill-search'] === '1')
    check('技能超过 6 个时出现筛选框', search.length === 1, search.length)
    const texts = nodes.map((element) => String(element.props?.children ?? '')).join(' ')
    check('显示数据来源', texts.includes('skillsVia'), texts.slice(0, 80))
    check('scope 已生效时不提示「可能不全」', !texts.includes('skillsGlobalOnly'))
    check('model/user 徽章按 invocation 区分', nodes.filter((element) => String(element.props?.children ?? '') === 'skillsModelNo').length === 1)
  }

  const labsCard = findComponent(settingsTree, 'LabsCard')
  if (labsCard) {
    const expanded = collect(renderDeep({ ...labsCard, props: { ...labsCard.props } }))
    const toggle = expanded.find((element) => element.props?.['data-embodiment-labs-toggle'] === '1')
    check('Labs 卡片有展开按钮', Boolean(toggle))
  } else {
    check('Settings 里挂了 LabsCard', false)
  }

  const inventoryCard = findComponent(settingsTree, 'InventoryCard')
  check('Settings 里挂了 InventoryCard', Boolean(inventoryCard))

  const pricingSection = findComponent(settingsTree, 'PricingSection')
  check('Settings 里挂了 PricingSection', Boolean(pricingSection))

  const dataCard = findComponent(settingsTree, 'DataCard')
  check('Settings 里挂了 DataCard', Boolean(dataCard))

  const sessionBudget = findComponent(settingsTree, 'SessionBudgetCard')
  check('Settings 里挂了 SessionBudgetCard', Boolean(sessionBudget))
}

// ── 其它 tab 的卡片也要真渲染（以前只到顶层壳）──────────────────────────────
{
  const trendTree = renderDeep(renderTab('trend').tree)
  const trendNodes = collect(trendTree)
  check('trend tab 渲染出 TrendCard 内容', trendNodes.some((element) => String(element.props?.children ?? '').length > 0))
  check('trend tab 无卡片级报错', !trendNodes.some((element) => element.props?.['data-embodiment-card-error'] === '1'), trendNodes.filter((element) => element.props?.['data-embodiment-card-error'] === '1').length)

  const eventsTree = renderDeep(renderTab('events').tree)
  check('events tab 渲染无卡片级报错', !collect(eventsTree).some((element) => element.props?.['data-embodiment-card-error'] === '1'))
}


// ── 技能筛选：真的改输入值，看行数变化 ────────────────────────────────────────
// 靠 per-component 状态隔离：给 SkillsCard 的第 4 个 useState（query）注入初值，
// 不必数面板用了多少个 hook，面板结构变了也不会失效。
{
  const payload = {
    ok: true,
    via: 'registry',
    scopeApplied: true,
    complete: true,
    cwd: '/w',
    counts: { total: 4, model: 4, user: 4 },
    skills: [
      { name: 'alpha-skill', description: 'from project', source: 'project-agents', path: '/w/a/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'beta-skill', description: 'hidden from model', source: 'project-agents', path: '/w/b/SKILL.md', modelInvocable: false, userInvocable: true },
      { name: 'gamma-skill', description: 'user level', source: 'user-agents', path: '/a/g/SKILL.md', modelInvocable: true, userInvocable: true },
      { name: 'delta-skill', description: 'needs ffmpeg', source: 'user-agents', path: '/a/d/SKILL.md', modelInvocable: true, userInvocable: false },
    ],
  }

  /** 用给定 query 渲染一次卡片，返回行名与文本节点。 */
  const renderWithQuery = (query) => {
    const react = makeReact({ 0: readyStatus }, { SkillsCard: { 3: query } })
    const loaded = loadClient(source, { react })
    for (const inject of loaded.slotInjects) inject.callback()
    const registration = loaded.slotRegistrations.find((entry) => entry.definition?.name === 'settings.section')
    const component = registration.component
    const first = component({ t, title: 'Context' })
    const tabButton = collect(first).find((element) => element.props?.['data-embodiment-tab'] === 'settings')
    tabButton.props.onClick()
    react.__resetCursor()
    const tree = component({ t, title: 'Context' })
    const cardElement = collect(tree).find((element) => typeof element.type === 'function' && element.type.name === 'SkillsCard')
    if (!cardElement) return null
    const rendered = renderDeep({ ...cardElement, props: { ...cardElement.props, data: payload, loading: false, error: null, reload: () => {} } }, react)
    const nodes = collect(rendered)
    return {
      names: nodes.filter((element) => typeof element.props?.['data-embodiment-skill'] === 'string').map((element) => element.props['data-embodiment-skill']),
      texts: nodes.map((element) => String(element.props?.children ?? '')).join(' '),
    }
  }

  const unfiltered = renderWithQuery('')
  check('筛选：空查询显示全部 4 个', Array.isArray(unfiltered?.names) && unfiltered.names.length === 4, unfiltered?.names?.join(','))

  const byName = renderWithQuery('delta')
  check('筛选：命中名称时只留 1 行', byName?.names?.length === 1 && byName.names[0] === 'delta-skill', byName?.names?.join(','))

  // 命中描述而不是名称：证明筛选不只看 name
  const byDescription = renderWithQuery('ffmpeg')
  check('筛选：命中描述也能找到', byDescription?.names?.length === 1 && byDescription.names[0] === 'delta-skill', byDescription?.names?.join(','))

  // 筛选只覆盖 name / description / whenToUse，不覆盖 source：这两个技能描述里没有 'user-agents'
  const bySource = renderWithQuery('user-agents')
  check('筛选：不匹配来源名（范围仅名称/描述/whenToUse）', bySource?.names?.length === 0, bySource?.names?.join(','))

  const noMatch = renderWithQuery('zzz-nothing')
  check('筛选：无命中时显示空提示', noMatch?.names?.length === 0 && noMatch.texts.includes('skillsNoMatch'), noMatch?.texts?.slice(0, 60))

  // 大小写不敏感（实现里统一 toLowerCase）
  const upper = renderWithQuery('DELTA')
  check('筛选：大小写不敏感', upper?.names?.length === 1, upper?.names?.join(','))
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[render] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[render] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exitCode = 1
}
