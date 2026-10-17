/**
 * ctx-mon-and-con — 浏览器半侧（最小设置面板）
 *
 * 形态与宿主官方插件一致：bundle 只注册 factory，真正的模块体（词典注册、
 * slot 注册、React 组件）都在 factory 闭包里，首次被物化时才执行。
 * `id` 必须是本包的包名（client-modules 用「解析到的 manifest 包名」当浏览器
 * 模块身份）；`require("react")` 从平台共享模块表取，不需要打包 React。
 *
 * 加载链路（已验证）：package.json 的 exports["./client"] → dsh.client.platform
 * "web" → client-modules 把它变成 /plugins 下的 bundle → 浏览器壳的 cordis 加载
 * 本模块，读取 exports.inject 等服务依赖，再调用 apply(ctx)。
 */
window.__ModuleLoader__.load({
  id: 'ctx-mon-and-con',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** @type {{ createElement: Function, useState: Function, useEffect: Function, useCallback: Function }} */
    const react = require('react')

    // 词典命名空间；与 node 半侧无关，只影响面板上的文案。
    const NS = 'ctxMonAndCon'
    // node 半侧 index.js 里的 webServer 路由（同路径，改一处要同步另一处）。
    const STATUS_PATH = '/api/ctx-mon-and-con/status'

    const en = {
      nav: 'Context',
      title: 'Context length',
      description:
        'Reads the measurement recorded by the /ctx command. Run /ctx in a conversation to record the current usage.',
      budget: 'Configured budget',
      warnAt: 'Warn at',
      errorAt: 'Error at',
      recent: 'Recent /ctx measurements',
      none: 'No measurement yet. Run /ctx in a conversation.',
      loading: 'Loading…',
      refresh: 'Refresh',
      retry: 'Retry',
      error: 'Could not load status',
      hint: 'Tip: /ctx <tokens> temporarily overrides the budget for that conversation.',
      tokens: 'tokens',
      surface: 'surface',
      ratio: 'used',
      at: 'measured at',
      status: 'status',
      statusOk: 'ok',
      statusWarn: 'warning',
      statusError: 'over budget',
      control: 'Control',
      controlReady: 'Control row is mounted in the agent preset; the budget is enforced automatically.',
      controlMissing: 'Not active yet — mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group).',
      controlLast: 'Last compaction',
    }

    const zh = {
      nav: '上下文',
      title: '上下文长度',
      description: '读取 /ctx 命令记录下来的测量值；在会话里执行一次 /ctx 就会有数据。',
      budget: '当前预算',
      warnAt: '警告阈值',
      errorAt: '超限阈值',
      recent: '最近的 /ctx 测量',
      none: '还没有测量值。在会话里执行 /ctx 即可。',
      loading: '加载中…',
      refresh: '刷新',
      retry: '重试',
      error: '读取状态失败',
      hint: '提示：/ctx <tokens> 可临时覆盖该会话的预算。',
      tokens: 'tokens',
      surface: '消息表面',
      ratio: '已用',
      at: '测量时间',
      status: '状态',
      statusOk: '正常',
      statusWarn: '警告',
      statusError: '已超限',
      control: '控制',
      controlReady: '控制行已挂在 agent preset 内，超预算会自动压缩。',
      controlMissing: '尚未生效 —— 需要把 ctx-mon-and-con/control 加到 agent preset 的 compaction 组里（设置 → Agent preset → compaction group）。',
      controlLast: '最近一次压缩',
    }

    /** 必需服务（浏览器 cordis 的 fiber inject）。 */
    const inject = ['slots', 'locale']

    const h = react.createElement

    function formatTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      try {
        return new Intl.NumberFormat().format(Math.round(number))
      } catch {
        return String(Math.round(number))
      }
    }

    function formatPercent(value) {
      const number = Number(value)
      return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '—'
    }

    function formatTime(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return '—'
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px', color: 'inherit' },
      title: { margin: 0, fontSize: '15px', fontWeight: 600 },
      text: { margin: 0, fontSize: '12.5px', lineHeight: 1.55, opacity: 0.8 },
      card: {
        border: '1px solid rgba(127,127,127,0.32)',
        borderRadius: '10px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      row: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12.5px' },
      label: { opacity: 0.72 },
      button: {
        alignSelf: 'flex-start',
        fontSize: '12.5px',
        padding: '4px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.4)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      error: { color: '#f87171', fontSize: '12.5px', margin: 0 },
      mono: { fontVariantNumeric: 'tabular-nums' },
    }

    function statusText(t, status) {
      if (status === 'error') return t('statusError')
      if (status === 'warn') return t('statusWarn')
      return t('statusOk')
    }

    function measurementRow(t, measurement) {
      const key = String(measurement?.id ?? 'unknown')
      return h(
        'div',
        { key, style: { ...styles.card, gap: '4px' } },
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.mono }, `${formatTokens(measurement?.totalTokens)} / ${formatTokens(measurement?.budget)}`),
          h('span', { style: styles.label }, `${formatPercent(measurement?.ratio)} · ${statusText(t, measurement?.status)}`),
        ),
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.label }, `${t('surface')} ${formatTokens(measurement?.surfaceTokens)}`),
          h('span', { style: styles.label }, `${t('at')} ${formatTime(measurement?.at)}`),
        ),
      )
    }

    /** 设置面板本体：挂载即拉一次状态，失败可重试。 */
    function CtxMonAndConPanel(props) {
      const t = props.t
      const [state, setState] = react.useState({ phase: 'loading' })

      const load = react.useCallback(() => {
        setState({ phase: 'loading' })
        fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((data) => setState({ phase: 'ready', data }))
          .catch((error) => setState({ phase: 'error', message: String((error && error.message) || error) }))
      }, [])

      react.useEffect(() => {
        load()
      }, [load])

      const children = [h('h2', { key: 'title', style: styles.title }, t('title'))]

      if (state.phase === 'loading') {
        children.push(h('p', { key: 'loading', style: styles.text }, t('loading')))
      } else if (state.phase === 'error') {
        children.push(h('p', { key: 'error', style: styles.error }, `${t('error')}: ${state.message}`))
        children.push(h('button', { key: 'retry', type: 'button', style: styles.button, onClick: load }, t('retry')))
      } else {
        const data = state.data || {}
        const budget = data.budget || {}
        children.push(
          h(
            'div',
            { key: 'budget', style: styles.card },
            h(
              'div',
              { style: styles.row },
              h('span', { style: styles.label }, t('budget')),
              h('span', { style: styles.mono }, `${formatTokens(budget.tokens)} ${t('tokens')}`),
            ),
            h(
              'div',
              { style: styles.row },
              h('span', { style: styles.label }, t('warnAt')),
              h('span', { style: styles.mono }, formatPercent(budget.warnAt)),
            ),
            h(
              'div',
              { style: styles.row },
              h('span', { style: styles.label }, t('errorAt')),
              h('span', { style: styles.mono }, formatPercent(budget.errorAt)),
            ),
          ),
        )
        const control = data.control || {}
        children.push(
          h(
            'p',
            { key: 'control', style: styles.text },
            `${t('control')}: ${control.active ? t('controlReady') : t('controlMissing')}`,
          ),
        )
        if (control.active && control.lastCompaction) {
          children.push(
            h(
              'p',
              { key: 'control-last', style: styles.text },
              `${t('controlLast')}: ${formatTokens(control.lastCompaction.before)} → ${formatTokens(control.lastCompaction.after)} ${t('tokens')} · ${formatTime(control.lastCompactionAt)}`,
            ),
          )
        }
        const measurements = Array.isArray(data.measurements) ? data.measurements : []
        children.push(h('p', { key: 'recent-title', style: styles.text }, t('recent')))
        if (measurements.length === 0) {
          children.push(h('p', { key: 'none', style: styles.text }, t('none')))
        } else {
          children.push(h('div', { key: 'recent', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, measurements.map((m) => measurementRow(t, m))))
        }
        children.push(h('p', { key: 'hint', style: styles.text }, t('hint')))
        children.push(h('button', { key: 'refresh', type: 'button', style: styles.button, onClick: load }, t('refresh')))
      }

      return h('div', { style: styles.root }, children)
    }

    /**
     * @param {unknown} ctx - 浏览器 cordis 上下文（已注入 slots/locale）
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ctx-mon-and-con: dictionaries')
      const t = ctx.locale.bind(NS)
      // settings.section 是官方设置外壳声明的列表 slot；注册后设置导航里多一页。
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'ctx-mon-and-con',
                order: 40,
                label: () => t('nav'),
                locale: NS,
              },
              CtxMonAndConPanel,
            ),
          ),
        'ctx-mon-and-con: settings section',
      )
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
