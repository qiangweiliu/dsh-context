/**
 * ctx-mon-and-con — 浏览器半侧
 *
 * 同一个面板组件挂在三处：
 *   1. settings.section      —— 设置 → 「上下文长度」
 *   2. main (key = 'ctx')    —— 左侧导航的整页「ctx」
 *   3. sidebar.panellist     —— 左侧导航里的 ctx 图标
 *
 * 面板内容：当前预算 / 警告与超限阈值 / 最近一次 /ctx 测量 / 控制半侧是否生效，
 * 以及一个可编辑的全局配置表单（通过宿主配置路由写回本插件在 profile 里的
 * 那一行 config，写回后宿主会按新配置重挂插件）。
 *
 * 零 npm 依赖：React 由宿主模块表提供，其余全部走 ctx 服务。
 */
window.__ModuleLoader__.load({
  id: 'ctx-mon-and-con',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    /** 词典命名空间；与 node 半侧无关，只影响面板文案。 */
    const NS = 'ctxMonAndCon'
    /** node 半侧 index.js 里的状态路由；改一处要同步另一处。 */
    const STATUS_PATH = '/api/ctx-mon-and-con/status'
    /** 左侧导航的 panel id，同时是 main slot 的 key。 */
    const PANEL_ID = 'ctx'
    /** 本插件在 profile 里的 loader 行 id，也就是配置命名空间。 */
    const CONFIG_NAMESPACE = 'ctx-mon-and-con'

    const en = {
      nav: 'Context length',
      panel: 'ctx',
      title: 'Context length',
      pageTitle: 'ctx — context length control',
      description: 'Monitors this session’s context usage and edits the plugin’s global budget.',
      budget: 'Budget',
      used: 'Measured',
      ratio: 'Used',
      status: 'Status',
      statusOk: 'ok',
      statusWarn: 'warning',
      statusError: 'over budget',
      warnAt: 'Warn at',
      errorAt: 'Error at',
      recent: 'Recent /ctx measurements',
      none: 'No measurement yet. Run /ctx in a conversation.',
      loading: 'Loading…',
      refresh: 'Refresh',
      retry: 'Retry',
      error: 'Could not load status',
      hint: 'Tip: /ctx <tokens> temporarily overrides this session; /ctx reset restores the default.',
      tokens: 'tokens',
      surface: 'surface',
      at: 'measured at',
      control: 'Control',
      controlReady: 'Control row is mounted in the agent preset; the budget is enforced automatically.',
      controlMissing: 'Not active yet — mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group).',
      controlLast: 'Last compaction',
      configTitle: 'Global configuration',
      configHint: 'Writes to the profile’s config row; the plugin reloads with the new values.',
      configLoading: 'Waiting for the Host configuration…',
      configUnavailable: 'This client cannot edit the Host configuration — values are read-only here.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The plugin reloaded with the new configuration.',
      saveRefused: 'The Host refused the write.',
      saveFailed: 'Save failed',
      invalidTokens: 'Budget must be a positive integer.',
      invalidRatios: 'Thresholds must be in (0, 1] and warn must be below error.',
      defaultBudget: 'Default budget (tokens)',
      warnLabel: 'Warn ratio',
      errorLabel: 'Error ratio',
      dockBudget: 'ctx budget',
      controlEnable: 'Enable auto-compaction (writes the agent preset)',
      controlDisable: 'Disable auto-compaction (removes the preset row)',
      controlPresetHint: 'Writes one row into preset-standard; the preset config becomes a profile override.',
      controlBusy: 'Applying…',
      controlWriteFailed: 'Could not update the agent preset',
      controlEnabled: 'Auto-compaction is now enforced with this budget.',
      controlDisabled: 'Auto-compaction row removed from the agent preset.',
    }

    const zh = {
      nav: '上下文长度',
      panel: 'ctx',
      title: '上下文长度',
      pageTitle: 'ctx —— 上下文长度控制',
      description: '监控当前会话的上下文占用，并编辑插件的全局预算配置。',
      budget: '预算',
      used: '实测用量',
      ratio: '已用',
      status: '状态',
      statusOk: '正常',
      statusWarn: '警告',
      statusError: '已超限',
      warnAt: '警告阈值',
      errorAt: '超限阈值',
      recent: '最近的 /ctx 测量',
      none: '还没有测量值。在会话里执行 /ctx 即可。',
      loading: '加载中…',
      refresh: '刷新',
      retry: '重试',
      error: '读取状态失败',
      hint: '提示：/ctx <tokens> 临时覆盖本会话预算；/ctx reset 恢复默认。',
      tokens: 'tokens',
      surface: '消息表面',
      at: '测量时间',
      control: '控制',
      controlReady: '控制行已挂在 agent preset 内，超预算会自动压缩。',
      controlMissing: '尚未生效 —— 需要把 ctx-mon-and-con/control 加到 agent preset 的 compaction 组里（设置 → Agent preset → compaction group）。',
      controlLast: '最近一次压缩',
      configTitle: '全局配置',
      configHint: '写入 profile 里本插件的 config 行，保存后插件会按新配置重挂。',
      configLoading: '正在等待宿主配置…',
      configUnavailable: '当前客户端不能编辑宿主配置，这里只读。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件已按新配置重挂。',
      saveRefused: '宿主拒绝了这次写入。',
      saveFailed: '保存失败',
      invalidTokens: '预算必须是正整数。',
      invalidRatios: '阈值必须在 (0, 1] 之间，且警告阈值要小于超限阈值。',
      defaultBudget: '默认预算（tokens）',
      warnLabel: '警告比例',
      errorLabel: '超限比例',
      dockBudget: 'ctx 预算',
      controlEnable: '启用自动压缩（写入 agent preset）',
      controlDisable: '停用自动压缩（移除 preset 行）',
      controlPresetHint: '会往 preset-standard 里加一行；preset 配置会变成 profile 覆盖层。',
      controlBusy: '正在应用…',
      controlWriteFailed: '更新 agent preset 失败',
      controlEnabled: '自动压缩已启用，按当前预算执行。',
      controlDisabled: '已从 agent preset 移除自动压缩行。',
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
      page: { height: '100%', minHeight: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      pageInner: { maxWidth: '960px', margin: '0 auto', padding: '28px clamp(20px, 4vw, 40px) 56px' },
      root: { display: 'flex', flexDirection: 'column', gap: '14px', color: 'inherit' },
      title: { margin: 0, fontSize: '20px', fontWeight: 500, lineHeight: '28px' },
      subtitle: { margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      card: { border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: '14px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '13px' },
      label: { color: 'var(--dsw-alias-label-secondary)' },
      mono: { fontVariantNumeric: 'tabular-nums' },
      text: { margin: 0, fontSize: '12.5px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      error: { margin: 0, fontSize: '12.5px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)' },
      button: { alignSelf: 'flex-start', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '10px', padding: '5px 12px', fontSize: '12.5px', cursor: 'pointer' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px' },
      input: { width: '100%', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', padding: '6px 10px', fontSize: '13px' },
      cardTitle: { margin: 0, fontSize: '14px', fontWeight: 500 },
      tag: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
    }

    /** 拉取宿主状态接口（用法与设置分区一致）。 */
    function useStatus(path) {
      const [state, setState] = react.useState({ phase: 'loading' })
      const load = react.useCallback(() => {
        setState({ phase: 'loading' })
        fetch(path, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((data) => setState({ phase: 'ready', data }))
          .catch((error) => setState({ phase: 'error', message: String((error && error.message) || error) }))
      }, [path])
      react.useEffect(() => {
        load()
      }, [load])
      return [state, load]
    }

    function measurementRow(t, measurement) {
      const ratio = Number(measurement?.ratio)
      const statusKey = measurement?.status === 'error' ? 'statusError' : measurement?.status === 'warn' ? 'statusWarn' : 'statusOk'
      return h(
        'div',
        { key: measurement?.id, style: styles.card },
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.mono }, `${formatTokens(measurement?.totalTokens)} / ${formatTokens(measurement?.budget)}`),
          h('span', { style: styles.tag }, `${formatPercent(ratio)} · ${t(statusKey)}`),
        ),
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.tag }, `${t('surface')} ${formatTokens(measurement?.surfaceTokens)}`),
          h('span', { style: styles.tag }, `${t('at')} ${formatTime(measurement?.at)}`),
        ),
      )
    }

    /** 全局配置编辑：以当前预算为初值，POST 到宿主配置路由，并轮询到新预算生效。 */
    function ConfigEditor(props) {
      const t = props.t
      const budget = props.budget || {}
      const editable = Boolean(props.editable)
      const [draft, setDraft] = react.useState({ tokens: '', warn: '', error: '' })
      const [result, setResult] = react.useState({ kind: 'idle' })

      react.useEffect(() => {
        setDraft({
          tokens: budget.tokens === undefined ? '' : String(budget.tokens),
          warn: budget.warnAt === undefined ? '' : String(budget.warnAt),
          error: budget.errorAt === undefined ? '' : String(budget.errorAt),
        })
      }, [budget.tokens, budget.warnAt, budget.errorAt])

      const save = () => {
        const tokens = Number(draft.tokens)
        const warn = Number(draft.warn)
        const error = Number(draft.error)
        if (!Number.isInteger(tokens) || tokens <= 0) {
          setResult({ kind: 'error', message: t('invalidTokens') })
          return
        }
        if (!(warn > 0 && warn <= 1) || !(error > 0 && error <= 1) || warn >= error) {
          setResult({ kind: 'error', message: t('invalidRatios') })
          return
        }
        setResult({ kind: 'saving' })
        fetch(`${STATUS_PATH}/config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contextWindowTokens: tokens, warnAt: warn, errorAt: error }),
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}))
            if (response.status !== 202 || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`)
            // 落盘后宿主会重挂本插件；轮询状态接口直到新预算生效。
            const deadline = Date.now() + 8000
            for (;;) {
              await new Promise((resolve) => setTimeout(resolve, 400))
              try {
                const status = await (await fetch(STATUS_PATH)).json()
                if (status && status.budget && status.budget.tokens === tokens) return true
              } catch {}
              if (Date.now() > deadline) return false
            }
          })
          .then((applied) => {
            if (!applied) {
              setResult({ kind: 'error', message: t('saveRefused') })
              return
            }
            setResult({ kind: 'saved' })
            if (typeof props.onSaved === 'function') props.onSaved()
          })
          .catch((failure) => setResult({ kind: 'error', message: `${t('saveFailed')}: ${String((failure && failure.message) || failure)}` }))
      }

      const disabled = !editable || result.kind === 'saving'

      return h(
        'div',
        { style: styles.card },
        h('h3', { style: styles.cardTitle }, t('configTitle')),
        editable ? null : h('p', { style: styles.text }, t('configUnavailable')),
        h(
          'label',
          { style: styles.field },
          h('span', { style: styles.label }, t('defaultBudget')),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 1,
            step: 1000,
            value: draft.tokens,
            disabled,
            onChange: (event) => setDraft({ ...draft, tokens: event.target.value }),
          }),
        ),
        h(
          'label',
          { style: styles.field },
          h('span', { style: styles.label }, t('warnLabel')),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0.01,
            max: 1,
            step: 0.01,
            value: draft.warn,
            disabled,
            onChange: (event) => setDraft({ ...draft, warn: event.target.value }),
          }),
        ),
        h(
          'label',
          { style: styles.field },
          h('span', { style: styles.label }, t('errorLabel')),
          h('input', {
            style: styles.input,
            type: 'number',
            min: 0.01,
            max: 1,
            step: 0.01,
            value: draft.error,
            disabled,
            onChange: (event) => setDraft({ ...draft, error: event.target.value }),
          }),
        ),
        h('p', { style: styles.text }, t('configHint')),
        result.kind === 'saved' ? h('p', { style: styles.text }, t('saved')) : null,
        result.kind === 'error' ? h('p', { style: styles.error }, result.message) : null,
        h('button', { style: styles.button, type: 'button', onClick: save, disabled }, result.kind === 'saving' ? t('saving') : t('save')),
      )
    }

    /** 控制半侧状态 + 一键把控制行写进 agent preset / 移除。 */
    function ControlSection(props) {
      const t = props.t
      const control = props.control || {}
      const [state, setState] = react.useState({ kind: 'idle' })

      const toggle = (enable) => {
        setState({ kind: 'saving', enable })
        fetch(`${STATUS_PATH}/config/preset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enable }),
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}))
            if (response.status !== 202 || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`)
            const deadline = Date.now() + 10000
            for (;;) {
              await new Promise((resolve) => setTimeout(resolve, 500))
              try {
                const status = await (await fetch(STATUS_PATH)).json()
                if (status && status.control && status.control.active === enable) return true
              } catch {}
              if (Date.now() > deadline) return false
            }
          })
          .then((applied) => {
            setState({ kind: 'idle' })
            if (!applied) {
              setState({ kind: 'error', message: t('controlWriteFailed') })
              return
            }
            setState({ kind: 'notice', message: enable ? t('controlEnabled') : t('controlDisabled') })
            if (typeof props.onToggled === 'function') props.onToggled()
          })
          .catch((failure) => setState({ kind: 'error', message: `${t('controlWriteFailed')}: ${String((failure && failure.message) || failure)}` }))
      }

      const children = [
        h('p', { key: 'text', style: styles.text }, `${t('control')}: ${control.active ? t('controlReady') : t('controlMissing')}`),
      ]
      if (control.active && control.lastCompaction) {
        children.push(
          h(
            'p',
            { key: 'last', style: styles.text },
            `${t('controlLast')}: ${formatTokens(control.lastCompaction.before)} → ${formatTokens(control.lastCompaction.after)} ${t('tokens')} · ${formatTime(control.lastCompactionAt)}`,
          ),
        )
      }
      if (control.presetMountable) {
        children.push(h('p', { key: 'hint', style: styles.tag }, t('controlPresetHint')))
        const enable = !control.active
        children.push(
          h(
            'button',
            {
              key: 'toggle',
              type: 'button',
              style: styles.button,
              disabled: state.kind === 'saving',
              onClick: () => toggle(enable),
            },
            state.kind === 'saving' ? t('controlBusy') : enable ? t('controlEnable') : t('controlDisable'),
          ),
        )
      }
      if (state.kind === 'error') children.push(h('p', { key: 'error', style: styles.error }, state.message))
      if (state.kind === 'notice') children.push(h('p', { key: 'notice', style: styles.text }, state.message))
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, children)
    }

    /** 输入框下方的常驻小指示器：插件预算 + 当前会话实时占用。 */
    function CtxDock(props) {
      const t = props.t
      const sessionId = props.sessionId || (props.runtime && props.runtime.sessionId) || undefined
      const [data, setData] = react.useState(null)

      react.useEffect(() => {
        if (!sessionId) return undefined
        let cancelled = false
        let timer
        const tick = () => {
          fetch(`${STATUS_PATH}/live?sessionId=${encodeURIComponent(String(sessionId))}`, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              if (!cancelled && payload && payload.ok) setData(payload)
            })
            .catch(() => {})
            .finally(() => {
              if (!cancelled) timer = setTimeout(tick, 3000)
            })
        }
        tick()
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [sessionId])

      const budget = data && typeof data.budget === 'number' ? data.budget : null
      const used = data && typeof data.used === 'number' ? data.used : null
      const ratio = data && typeof data.ratio === 'number' ? data.ratio : null
      const color = ratio === null ? 'var(--dsw-alias-label-tertiary)' : ratio >= 0.9 ? 'var(--dsw-alias-state-error-primary)' : ratio >= 0.75 ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-tertiary)'
      const parts = [`ctx ${t('budget')}`]
      if (budget !== null) parts.push(formatTokens(budget))
      if (used !== null) parts.push(`· ${formatTokens(used)} (${ratio === null ? '—' : formatPercent(ratio)})`)
      return h(
        'div',
        {
          'data-ctx-dock': '1',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontSize: '11.5px',
            lineHeight: '16px',
            color,
            padding: '2px 0',
            fontVariantNumeric: 'tabular-nums',
          },
          title: used !== null && budget !== null ? `${formatTokens(used)} / ${formatTokens(budget)} tokens` : undefined,
        },
        h('span', null, parts.join(' ')),
      )
    }

    /** 共享面板：设置分区与整页都用它。 */
    function CtxPanel(props) {
      const t = props.t
      const [state, load] = useStatus(STATUS_PATH)
      const statusData = state.phase === 'ready' ? state.data || {} : null

      const children = [
        h('h2', { key: 'title', style: styles.title }, props.title || t('title')),
        h('p', { key: 'subtitle', style: styles.subtitle }, t('description')),
      ]

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
            h('div', { style: styles.row }, h('span', { style: styles.label }, t('warnAt')), h('span', { style: styles.mono }, formatPercent(budget.warnAt))),
            h('div', { style: styles.row }, h('span', { style: styles.label }, t('errorAt')), h('span', { style: styles.mono }, formatPercent(budget.errorAt))),
          ),
        )
        const control = data.control || {}
        children.push(h(ControlSection, { key: 'control', t, control, onToggled: load }))
        const measurements = Array.isArray(data.measurements) ? data.measurements : []
        children.push(h('h3', { key: 'recent-title', style: styles.cardTitle }, t('recent')))
        if (measurements.length === 0) {
          children.push(h('p', { key: 'none', style: styles.text }, t('none')))
        } else {
          children.push(h('div', { key: 'recent', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, measurements.map((m) => measurementRow(t, m))))
        }
        children.push(h('p', { key: 'hint', style: styles.text }, t('hint')))
        children.push(h('button', { key: 'refresh', type: 'button', style: styles.button, onClick: load }, t('refresh')))
      }

      children.push(h(ConfigEditor, { key: 'config', t, budget: statusData ? statusData.budget : undefined, editable: Boolean(statusData && statusData.configEditable), onSaved: load }))
      return h('div', { style: styles.root }, children)
    }

    /** 整页：包一层滚动容器与最大宽度。 */
    function CtxPage(props) {
      return h('div', { style: styles.page }, h('div', { style: styles.pageInner }, h(CtxPanel, { ...props, title: props.t('pageTitle') })))
    }

    /** 左侧导航图标（仪表盘）。 */
    function CtxIcon(props) {
      const size = Number(props && props.size) || 18
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { opacity: active ? 1 : 0.75 },
        },
        h('path', { d: 'M4 15a8 8 0 0 1 16 0' }),
        h('path', { d: 'M12 15l4.2-4.2' }),
        h('circle', { cx: 12, cy: 15, r: 1.4, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /**
     * @param {unknown} ctx - 浏览器 cordis 上下文（slots / locale）
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ctx-mon-and-con: dictionaries')
      const t = ctx.locale.bind(NS)
      const face = () => ({ t })

      // 1) 设置 → 上下文长度（与之前一致，组件换成共享面板）
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: CONFIG_NAMESPACE, order: 40, locale: NS, label: () => t('nav'), inject: face },
          CtxPanel,
        ),
      )

      // 2) 左侧导航整页：main slot 用 key 定位，panellist 提供图标与标题
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: face }, CtxPage),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') },
          CtxIcon,
        ),
      )

      // 3) 输入框下方常驻指示器：插件预算 + 当前会话实时占用
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'ctx-usage', order: 10, locale: NS, inject: face }, CtxDock),
      )
    }

    exports.NS = NS
    exports.PANEL_ID = PANEL_ID
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
