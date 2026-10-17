/**
 * ctx-mon-and-con — 浏览器半侧
 *
 * 三个挂载点共用一套视觉：
 *   1. conversation.composer.dock —— 输入框下方，与 DSH 内置 ContextMeter 同一排版
 *   2. main (key = 'ctx')         —— 左侧导航整页
 *   3. settings.section           —— 设置 → 上下文长度
 *
 * 视觉参考：DSH 自带 ContextMeter 的 trigger/panel 尺寸与颜色 token；
 * 面板卡片布局参考 dsh-context 插件（lc-card / lc-chip / lc-legend 的信息密度），
 * 但全部用内联样式 + --dsw-alias-* token 实现，不引入 CSS 文件、不依赖 Tailwind。
 */
window.__ModuleLoader__.load({
  id: 'ctx-mon-and-con',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    const NS = 'ctxMonAndCon'
    const STATUS_PATH = '/api/ctx-mon-and-con/status'
    const PANEL_ID = 'ctx'
    const CONFIG_NAMESPACE = 'ctx-mon-and-con'

    const en = {
      nav: 'Context length',
      panel: 'ctx',
      ctxBrand: 'ctx',
      title: 'Context length',
      pageTitle: 'ctx — context length control',
      description: 'Monitors this session’s context usage and edits the plugin’s global budget.',
      budget: 'Budget',
      used: 'Measured',
      remaining: 'Remaining',
      ratio: 'Used',
      status: 'Status',
      statusOk: 'ok',
      statusWarn: 'warning',
      statusError: 'over budget',
      warnAt: 'Warn at',
      errorAt: 'Error at',
      recent: 'Recent /ctx measurements',
      chartTitle: 'Usage trend',
      none: 'No measurement yet. Run /ctx in a conversation.',
      loading: 'Loading…',
      refresh: 'Refresh',
      retry: 'Retry',
      error: 'Could not load status',
      hint: 'Tip: /ctx <tokens> temporarily overrides this session; /ctx reset restores the default.',
      tokens: 'tokens',
      at: 'measured at',
      control: 'Control',
      controlOn: 'enabled',
      controlOff: 'not active',
      controlReady: 'Control row is mounted in the agent preset; the budget is enforced automatically.',
      controlMissing: 'Not active yet — mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group).',
      controlLast: 'Last compaction',
      controlEnable: 'Enable auto-compaction (writes the agent preset)',
      controlDisable: 'Disable auto-compaction (removes the preset row)',
      controlPresetHint: 'Writes one row into preset-standard; the preset config becomes a profile override.',
      controlBusy: 'Applying…',
      controlWriteFailed: 'Could not update the agent preset',
      controlEnabled: 'Auto-compaction is now enforced with this budget.',
      controlDisabled: 'Auto-compaction row removed from the agent preset.',
      configTitle: 'Global configuration',
      configHint: 'Writes to the profile’s config row; the plugin reloads with the new values.',
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
      collapse: 'Collapse',
      expand: 'Expand',
      meterAria: 'ctx budget',
    }

    const zh = {
      nav: '上下文长度',
      panel: 'ctx',
      ctxBrand: 'ctx',
      title: '上下文长度',
      pageTitle: 'ctx —— 上下文长度控制',
      description: '监控当前会话的上下文占用，并编辑插件的全局预算配置。',
      budget: '预算',
      used: '实测用量',
      remaining: '剩余',
      ratio: '已用',
      status: '状态',
      statusOk: '正常',
      statusWarn: '警告',
      statusError: '已超限',
      warnAt: '警告阈值',
      errorAt: '超限阈值',
      recent: '最近的 /ctx 测量',
      chartTitle: '用量趋势',
      none: '还没有测量值。在会话里执行 /ctx 即可。',
      loading: '加载中…',
      refresh: '刷新',
      retry: '重试',
      error: '读取状态失败',
      hint: '提示：/ctx <tokens> 临时覆盖本会话预算；/ctx reset 恢复默认。',
      tokens: 'tokens',
      at: '测量时间',
      control: '控制',
      controlOn: '已启用',
      controlOff: '未启用',
      controlReady: '控制行已挂在 agent preset 内，超预算会自动压缩。',
      controlMissing: '尚未生效 —— 需要把 ctx-mon-and-con/control 加到 agent preset 的 compaction 组里（设置 → Agent preset → compaction group）。',
      controlLast: '最近一次压缩',
      controlEnable: '启用自动压缩（写入 agent preset）',
      controlDisable: '停用自动压缩（移除 preset 行）',
      controlPresetHint: '会往 preset-standard 里加一行；preset 配置会变成 profile 覆盖层。',
      controlBusy: '正在应用…',
      controlWriteFailed: '更新 agent preset 失败',
      controlEnabled: '自动压缩已启用，按当前预算执行。',
      controlDisabled: '已从 agent preset 移除自动压缩行。',
      configTitle: '全局配置',
      configHint: '写入 profile 里本插件的 config 行，保存后插件会按新配置重挂。',
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
      collapse: '收起',
      expand: '展开',
      meterAria: 'ctx 预算',
    }

    const inject = ['slots', 'locale']

    const h = react.createElement

    // ── 数字格式 ────────────────────────────────────────────────────────────
    function compactTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (number < 1000) return String(Math.round(number))
      if (number < 1e6) {
        const scaled = number / 1000
        return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}K`
      }
      const scaled = number / 1e6
      return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}M`
    }

    function formatTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      try {
        return new Intl.NumberFormat().format(Math.round(number))
      } catch {
        return String(Math.round(number))
      }
    }

    function formatPercent(value, digits = 1) {
      const number = Number(value)
      return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : '—'
    }

    function formatTime(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return '—'
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
    }

    function ratioColor(ratio) {
      if (ratio === null || ratio === undefined) return 'var(--dsw-alias-label-tertiary)'
      if (ratio >= 0.9) return 'var(--dsw-alias-state-error-primary)'
      if (ratio >= 0.75) return 'var(--dsw-alias-state-warning-primary)'
      return 'var(--dsw-alias-brand-primary)'
    }

    // ── 内置 ContextMeter 的视觉规格（trigger / panel / bar / rows） ────────
    const meter = {
      root: { position: 'relative', flex: 'none', display: 'inline-flex' },
      trigger: {
        borderRadius: 'var(--dsw-radius-sm)',
        color: 'var(--dsw-alias-label-tertiary)',
        fontFamily: 'inherit',
        fontSize: 'var(--dsh-content-font-size-secondary,13px)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary,0px))',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        flex: 'none',
        alignItems: 'center',
        gap: '6px',
        padding: '1px 8px',
        display: 'inline-flex',
      },
      triggerHover: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)' },
      panel: {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        zIndex: 1100,
        boxSizing: 'border-box',
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)',
        width: 'min(264px, calc(100vw - 24px))',
        backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-prominent)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'default',
        border: 0,
        padding: '12px',
        fontSize: '12px',
        lineHeight: '20px',
        textAlign: 'left',
      },
      header: { alignItems: 'center', gap: '6px', display: 'flex' },
      headline: { color: 'var(--dsw-alias-label-tertiary)' },
      percent: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
      figures: { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)', marginLeft: 'auto', fontWeight: 500 },
      bar: { background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: '999px', gap: '1px', height: '4px', margin: '10px 0 12px', display: 'flex', overflow: 'hidden' },
      segment: { borderRadius: '1px', flex: 'none', minWidth: '2px', height: '100%' },
      rows: { margin: '6px 0 0', padding: 0 },
      row: { justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '2px 0', display: 'flex' },
      swatch: { verticalAlign: 'baseline', borderRadius: '2px', width: '8px', height: '8px', marginRight: '6px', display: 'inline-block' },
      system: { background: 'var(--dsw-static-neutral-bluish-400)' },
      tools: { background: '#a78bfa' },
      messages: { background: 'var(--dsw-static-blue-450)' },
    }

    // ── 面板视觉（参考 dsh-context 的卡片/标题/chip/图例语义） ───────────────
    const styles = {
      page: { height: '100%', minHeight: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      pageInner: { maxWidth: '980px', margin: '0 auto', padding: '26px clamp(20px, 4vw, 40px) 56px', display: 'flex', flexDirection: 'column', gap: '12px' },
      root: { display: 'flex', flexDirection: 'column', gap: '12px' },
      title: { margin: 0, fontSize: '20px', fontWeight: 600, lineHeight: '28px' },
      subtitle: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      cols: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'stretch' },
      card: {
        flex: '1 1 300px',
        minWidth: 'min(280px, 100%)',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      cardHead: { display: 'flex', alignItems: 'center', gap: '8px' },
      cardTitle: { margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      cardSub: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover)', padding: '1px 6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', minWidth: 0 },
      chipStrong: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums', fontSize: '12.5px' },
      dot: { width: '8px', height: '8px', borderRadius: '2px', display: 'inline-block' },
      bar: { background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: '999px', height: '4px', display: 'flex', overflow: 'hidden' },
      barFill: { borderRadius: '999px', height: '100%', minWidth: '2px' },
      legend: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px 12px', margin: 0, padding: 0, listStyle: 'none' },
      legendRow: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' },
      legendLabel: { color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex', alignItems: 'center' },
      legendValue: { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' },
      chartRow: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '64px', padding: '4px 2px 0' },
      barCol: { flex: '1 1 0', minWidth: '4px', maxWidth: '22px', borderRadius: '3px 3px 0 0', background: 'var(--dsw-alias-label-tertiary)', opacity: 0.55 },
      empty: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '12.5px' },
      text: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)' },
      button: { alignSelf: 'flex-start', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '8px', padding: '4px 10px', fontSize: '12.5px', cursor: 'pointer' },
      collapseHead: { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', fontWeight: 600, textAlign: 'left' },
      chev: { display: 'inline-block', width: '10px', transition: 'transform .15s ease' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' },
      label: { color: 'var(--dsw-alias-label-secondary)' },
      input: { width: '100%', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', padding: '5px 9px', fontSize: '12.5px' },
    }

    // ── 基础视觉组件 ────────────────────────────────────────────────────────
    function Ring(props) {
      const percent = Math.max(0, Math.min(100, Number(props.percent) || 0))
      const radius = 5.5
      const circumference = 2 * Math.PI * radius
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { cx: 7, cy: 7, r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 2 }),
        h('circle', {
          cx: 7,
          cy: 7,
          r: radius,
          fill: 'none',
          stroke: props.color || 'var(--dsw-alias-label-tertiary)',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
          transform: 'rotate(-90 7 7)',
        }),
      )
    }

    function MeterBar(props) {
      const percent = Math.max(0, Math.min(100, Number(props.percent) || 0))
      return h('div', { style: styles.bar }, h('div', { style: { ...styles.barFill, width: `${percent}%`, background: props.color || 'var(--dsw-alias-brand-primary)' } }))
    }

    function StatChip(props) {
      return h(
        'span',
        { style: styles.chip, title: props.title },
        props.dot ? h('i', { style: { ...styles.dot, background: props.dot } }) : null,
        h('span', null, props.label),
        props.value !== undefined ? h('b', { style: styles.chipStrong }, props.value) : null,
      )
    }

    function Card(props) {
      return h(
        'div',
        { style: { ...styles.card, ...(props.style || {}) } },
        h(
          'div',
          { style: styles.cardHead },
          h('h3', { style: styles.cardTitle }, props.title),
          props.sub !== undefined ? h('span', { style: styles.cardSub }, props.sub) : null,
          props.action !== undefined ? props.action : null,
        ),
        props.children,
      )
    }

    function CollapsibleCard(props) {
      const [open, setOpen] = react.useState(props.defaultOpen === true)
      return h(
        'div',
        { style: styles.card },
        h(
          'button',
          { type: 'button', style: styles.collapseHead, onClick: () => setOpen(!open), 'aria-expanded': open, title: open ? props.t('collapse') : props.t('expand') },
          h('span', { style: { ...styles.chev, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' } }, '›'),
          props.title,
          props.sub !== undefined ? h('span', { style: styles.cardSub }, props.sub) : null,
        ),
        open ? props.children : null,
      )
    }

    // ── 数据 hooks ─────────────────────────────────────────────────────────
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

    // ── 输入框下方指示器：与内置 ContextMeter 同排版，点击弹出小明细 ────────
    function CtxDock(props) {
      const t = props.t
      const sessionId = props.sessionId || (props.runtime && props.runtime.sessionId) || undefined
      const [data, setData] = react.useState(null)
      const [open, setOpen] = react.useState(false)
      const [hovered, setHovered] = react.useState(false)
      const rootRef = react.useRef(null)

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

      react.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const budget = data && typeof data.budget === 'number' ? data.budget : null
      const used = data && typeof data.used === 'number' ? data.used : null
      const ratio = data && typeof data.ratio === 'number' ? data.ratio : null
      const percent = ratio === null ? null : Math.round(ratio * 100)
      const color = ratioColor(ratio)
      const label = percent === null ? `${t('ctxBrand')} —` : `${t('ctxBrand')} ${percent}%`

      return h(
        'span',
        { ref: rootRef, style: meter.root },
        h(
          'button',
          {
            type: 'button',
            style: { ...meter.trigger, ...(hovered || open ? meter.triggerHover : null) },
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': `${t('meterAria')}${percent === null ? '' : ` ${percent}%`}`,
            title: used !== null && budget !== null ? `${formatTokens(used)} / ${formatTokens(budget)} ${t('tokens')}` : t('meterAria'),
            'data-ctx-dock': '1',
            onClick: () => setOpen(!open),
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          },
          h(Ring, { percent: percent ?? 0, color }),
          h('span', null, label),
        ),
        open
          ? h(
              'div',
              { style: meter.panel, role: 'dialog', 'aria-label': t('meterAria') },
              h(
                'div',
                { style: meter.header },
                h('span', { style: meter.headline }, t('budget')),
                h('span', { style: meter.percent }, percent === null ? '—' : `${percent}%`),
                h('span', { style: meter.figures }, `~${compactTokens(used)} / ${compactTokens(budget)}`),
              ),
              h('div', { style: meter.bar }, h('div', { style: { ...meter.segment, width: `${Math.max(0, Math.min(100, percent ?? 0))}%`, background: color } })),
              h(
                'dl',
                { style: meter.rows },
                h('div', { style: meter.row }, h('dt', null, t('used')), h('dd', { style: meter.figures }, compactTokens(used))),
                h('div', { style: meter.row }, h('dt', null, t('remaining')), h('dd', { style: meter.figures }, budget !== null && used !== null ? compactTokens(Math.max(0, budget - used)) : '—')),
                h('div', { style: meter.row }, h('dt', null, t('control')), h('dd', { style: meter.figures }, props.controlActive ? t('controlOn') : t('controlOff'))),
              ),
            )
          : null,
      )
    }

    // ── 面板内部区块 ───────────────────────────────────────────────────────
    function OverviewCard(props) {
      const t = props.t
      const budget = props.budget || {}
      const latest = props.latest
      const used = latest && typeof latest.totalTokens === 'number' ? latest.totalTokens : null
      const ratio = used !== null && budget.tokens > 0 ? used / budget.tokens : null
      const color = ratioColor(ratio)
      return h(
        Card,
        { title: t('budget'), sub: latest ? formatTime(latest.at) : undefined },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
          h('span', { style: { fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color } }, ratio === null ? '—' : formatPercent(ratio)),
          h('span', { style: { ...styles.cardSub, marginLeft: 0 } }, `${compactTokens(used)} / ${compactTokens(budget.tokens)} ${t('tokens')}`),
        ),
        h(MeterBar, { percent: ratio === null ? 0 : ratio * 100, color }),
        h(
          'div',
          { style: styles.chipRow },
          h(StatChip, { label: t('warnAt'), value: formatPercent(budget.warnAt, 0) }),
          h(StatChip, { label: t('errorAt'), value: formatPercent(budget.errorAt, 0) }),
          h(StatChip, { label: t('control'), value: props.controlActive ? t('controlOn') : t('controlOff'), dot: props.controlActive ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)' }),
        ),
        h('p', { style: styles.text }, t('hint')),
      )
    }

    function TrendCard(props) {
      const t = props.t
      const rows = Array.isArray(props.measurements) ? props.measurements.slice(0, 14).reverse() : []
      const budget = props.budget && props.budget.tokens > 0 ? props.budget.tokens : 0
      const maxValue = Math.max(1, ...rows.map((row) => Number(row.totalTokens) || 0), budget ? budget * 0.2 : 0)
      const bars = rows.map((row, index) => {
        const value = Number(row.totalTokens) || 0
        const height = Math.max(3, Math.round((value / maxValue) * 60))
        return h('div', {
          key: row.id || index,
          style: {
            ...styles.barCol,
            height: `${height}px`,
            opacity: row.status === 'error' ? 0.95 : 0.55,
            background: row.status === 'error' ? 'var(--dsw-alias-state-error-primary)' : row.status === 'warn' ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-brand-primary)',
          },
          title: `${formatTokens(row.totalTokens)} / ${formatTokens(row.budget)} · ${formatPercent(row.ratio)} · ${formatTime(row.at)}`,
        })
      })
      return h(
        Card,
        { title: t('chartTitle'), sub: rows.length > 0 ? String(rows.length) : undefined },
        rows.length === 0
          ? h('p', { style: styles.empty }, t('none'))
          : h('div', { style: styles.chartRow }, bars),
        rows.length > 0
          ? h(
              'ul',
              { style: styles.legend },
              rows
                .slice(-4)
                .reverse()
                .map((row, index) =>
                  h(
                    'li',
                    { key: row.id || index, style: styles.legendRow, title: `${t('at')} ${formatTime(row.at)}` },
                    h('span', { style: styles.legendLabel }, `${formatTokens(row.totalTokens)} / ${formatTokens(row.budget)}`),
                    h('span', { style: styles.legendValue }, formatPercent(row.ratio)),
                  ),
                ),
            )
          : null,
      )
    }

    function ControlSection(props) {
      const t = props.t
      const control = props.control || {}
      const [state, setState] = react.useState({ kind: 'idle' })

      const toggle = (enable) => {
        setState({ kind: 'saving' })
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
            if (!applied) {
              setState({ kind: 'error', message: t('controlWriteFailed') })
              return
            }
            setState({ kind: 'notice', message: enable ? t('controlEnabled') : t('controlDisabled') })
            if (typeof props.onToggled === 'function') props.onToggled()
          })
          .catch((failure) => setState({ kind: 'error', message: `${t('controlWriteFailed')}: ${String((failure && failure.message) || failure)}` }))
      }

      return h(
        Card,
        {
          title: t('control'),
          sub: control.active ? t('controlOn') : t('controlOff'),
        },
        h('p', { style: styles.text }, control.active ? t('controlReady') : t('controlMissing')),
        control.active && control.lastCompaction
          ? h(
              'p',
              { style: styles.text },
              `${t('controlLast')}: ${compactTokens(control.lastCompaction.before)} → ${compactTokens(control.lastCompaction.after)} ${t('tokens')} · ${formatTime(control.lastCompactionAt)}`,
            )
          : null,
        control.presetMountable ? h('p', { style: styles.text }, t('controlPresetHint')) : null,
        control.presetMountable
          ? h(
              'button',
              { type: 'button', style: styles.button, disabled: state.kind === 'saving', onClick: () => toggle(!control.active) },
              state.kind === 'saving' ? t('controlBusy') : control.active ? t('controlDisable') : t('controlEnable'),
            )
          : null,
        state.kind === 'error' ? h('p', { style: styles.error }, state.message) : null,
        state.kind === 'notice' ? h('p', { style: styles.text }, state.message) : null,
      )
    }

    function ConfigSection(props) {
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
        CollapsibleCard,
        { t, title: t('configTitle'), sub: editable ? undefined : t('configUnavailable'), defaultOpen: false },
        editable
          ? h(
              'div',
              { style: styles.chipRow },
              h(
                'label',
                { style: styles.field },
                h('span', { style: styles.label }, t('defaultBudget')),
                h('input', { style: styles.input, type: 'number', min: 1, step: 1000, value: draft.tokens, disabled, onChange: (event) => setDraft({ ...draft, tokens: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h('span', { style: styles.label }, t('warnLabel')),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 1, step: 0.01, value: draft.warn, disabled, onChange: (event) => setDraft({ ...draft, warn: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h('span', { style: styles.label }, t('errorLabel')),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 1, step: 0.01, value: draft.error, disabled, onChange: (event) => setDraft({ ...draft, error: event.target.value }) }),
              ),
            )
          : null,
        h('p', { style: styles.text }, t('configHint')),
        result.kind === 'saved' ? h('p', { style: styles.text }, t('saved')) : null,
        result.kind === 'error' ? h('p', { style: styles.error }, result.message) : null,
        editable ? h('button', { type: 'button', style: styles.button, onClick: save, disabled }, result.kind === 'saving' ? t('saving') : t('save')) : null,
      )
    }

    /** 共享面板：设置分区与整页都用它。 */
    function CtxPanel(props) {
      const t = props.t
      const [state, load] = useStatus(STATUS_PATH)
      const data = state.phase === 'ready' ? state.data || {} : null
      const budget = data ? data.budget || {} : {}
      const control = data ? data.control || {} : {}
      const measurements = data && Array.isArray(data.measurements) ? data.measurements : []
      const latest = measurements.length > 0 ? measurements[0] : null

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
        children.push(
          h(
            'div',
            { key: 'cols', style: styles.cols },
            h(OverviewCard, { t, budget, latest, controlActive: Boolean(control.active) }),
            h(TrendCard, { t, measurements, budget }),
          ),
        )
        children.push(
          h('div', { key: 'cols2', style: styles.cols }, h(ControlSection, { t, control, onToggled: load }), h(ConfigSection, { t, budget, editable: Boolean(data.configEditable), onSaved: load })),
        )
        children.push(h('button', { key: 'refresh', type: 'button', style: styles.button, onClick: load }, t('refresh')))
      }
      return h('div', { style: styles.root }, children)
    }

    function CtxPage(props) {
      return h(
        'div',
        { style: styles.page },
        h('div', { style: styles.pageInner }, h(CtxPanel, { ...props, title: props.t('pageTitle') })),
      )
    }

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

    /** @param {unknown} ctx - 浏览器 cordis 上下文（slots / locale） */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ctx-mon-and-con: dictionaries')
      const t = ctx.locale.bind(NS)
      const face = () => ({ t })

      // 1) 设置 → 上下文长度
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: CONFIG_NAMESPACE, order: 40, locale: NS, label: () => t('nav'), inject: face },
          CtxPanel,
        ),
      )

      // 2) 左侧导航整页 + 图标
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: face }, CtxPage))
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, CtxIcon),
      )

      // 3) 输入框下方指示器（与内置 ContextMeter 同排版，可点开小明细）
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'ctx-usage', order: 10, locale: NS, inject: face }, (props) => {
          const [active, setActive] = react.useState(false)
          react.useEffect(() => {
            let cancelled = false
            fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
              .then((response) => (response.ok ? response.json() : null))
              .then((payload) => {
                if (!cancelled && payload && payload.control) setActive(Boolean(payload.control.active))
              })
              .catch(() => {})
            return () => {
              cancelled = true
            }
          }, [])
          return h(CtxDock, { ...props, t, controlActive: active })
        }),
      )
    }

    exports.NS = NS
    exports.PANEL_ID = PANEL_ID
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
