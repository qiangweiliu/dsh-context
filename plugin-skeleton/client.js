/**
 * ctx-mon-and-con — 浏览器半侧
 *
 * 三个挂载点共用一套视觉：
 *   1. conversation.composer.dock —— 输入框下方，与 DSH 内置 ContextMeter 同一排版
 *   2. main (key = 'ctx')         —— 左侧导航整页
 *   3. settings.section           —— 设置 → 上下文长度
 *
 * 视觉参考：DSH 自带 ContextMeter 的 trigger/panel 尺寸与颜色 token；
 * 面板卡片布局参考 dsh-context 插件（lc-card / lc-card-title / lc-chip 的信息密度），
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
      description: 'Monitors this session’s context usage and edits the plugin’s global context limit.',
      budget: 'Context limit',
      used: 'Measured',
      remaining: 'Remaining',
      ratio: 'Used',
      status: 'Status',
      statusOk: 'ok',
      statusWarn: 'warning',
      statusError: 'over the context limit',
      warnAt: 'Warn at',
      errorAt: 'Error at',
      recent: 'Recent /ctx measurements',
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
      controlReady: 'Control row is mounted in the agent preset; the context limit is enforced automatically.',
      controlMissing: 'Not active yet — mount ctx-mon-and-con/control inside the agent preset (Settings → Agent preset → compaction group).',
      controlLast: 'Last compaction',
      controlEnable: 'Enable auto-compaction (writes the agent preset)',
      controlDisable: 'Disable auto-compaction (removes the preset row)',
      controlPresetHint: 'Writes one row into preset-standard; the preset config becomes a profile override.',
      controlBusy: 'Applying…',
      controlWriteFailed: 'Could not update the agent preset',
      controlEnabled: 'Auto-compaction is now enforced with this context limit.',
      controlError: 'Last compaction issue',
      controlDisabled: 'Auto-compaction row removed from the agent preset.',
      configTitle: 'Global configuration',
      configHint: 'Writes to the profile’s config row; the plugin reloads with the new values.',
      configUnavailable: 'This client cannot edit the Host configuration — values are read-only here.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The plugin reloaded with the new configuration.',
      saveRefused: 'The Host refused the write.',
      saveFailed: 'Save failed',
      invalidTokens: 'Context limit must be a positive integer.',
      invalidRatios: 'Thresholds must be in (0, 1] and warn must be below error.',
      defaultBudget: 'Default context limit (tokens)',
      warnLabel: 'Warn ratio',
      errorLabel: 'Error ratio',
      meterAria: 'ctx context limit',
      synced: 'synced',
      inventoryTitle: 'Tools & prompt sections',
      inventoryTools: 'Tools',
      inventoryPrompts: 'Prompt sections',
      inventoryEmpty: 'No request yet in this session. Send one message, then reopen this page.',
      inventoryRisk: 'Disabling removes the item from the next request. The model may behave unexpectedly; you can restore everything here.',
      sessionSwitch: 'session',
      globalSwitch: 'global',
      confirmDisable: 'Disable on next request?',
      confirm: 'Confirm',
      cancel: 'Cancel',
      restoreAll: 'Restore all',
      restoreConfirm: 'Clears session toggles, global prompt edits and global tool disables. Continue?',
      tokensShort: 'tok',
      copy: 'Copy',
      copied: 'Copied',
      parameters: 'Parameters (JSON Schema)',
      source: 'Source',
      sourceUnknown: 'unidentified',
      edit: 'Edit',
      save: 'Save',
      confirmSave: 'Overwrite the global prompt section on next request?',
      resetOriginal: 'Restore original',
      restoreAllPrompts: 'Restore all prompt edits (global)',
      overridden: 'overridden (global)',
      globalOverridden: 'overridden (global)',
      sessionOverridden: 'overridden (session)',
      saveSession: 'Save to this session',
      saveGlobal: 'Save globally',
      savedSession: 'Saved for this session (applies to the next request).',
      savedGlobal: 'Saved globally.',
      confirmGlobal: 'Save globally? It affects every session and is written to the profile.',
      resetSession: 'Reset session override',
      editHint: 'Writes profile config (global). Original kept for restore.',
      promptTokens: 'Prompt',
      toolTokens: 'Tools',
      historyTokens: 'History',
      userTokens: 'This turn',
    }

    const zh = {
      nav: '上下文长度',
      panel: 'ctx',
      ctxBrand: 'ctx',
      title: '上下文长度',
      pageTitle: 'ctx —— 上下文长度控制',
      description: '监控当前会话的上下文占用，并编辑插件的全局上下文配置。',
      budget: '上下文',
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
      loading: '加载中…',
      refresh: '刷新',
      retry: '重试',
      error: '读取状态失败',
      hint: '提示：/ctx <tokens> 临时覆盖本会话上下文；/ctx reset 恢复默认。',
      tokens: 'tokens',
      at: '测量时间',
      control: '控制',
      controlOn: '已启用',
      controlOff: '未启用',
      controlReady: '控制行已挂在 agent preset 内，超出上下文会自动压缩。',
      controlMissing: '尚未生效 —— 需要把 ctx-mon-and-con/control 加到 agent preset 的 compaction 组里（设置 → Agent preset → compaction group）。',
      controlLast: '最近一次压缩',
      controlEnable: '启用自动压缩（写入 agent preset）',
      controlDisable: '停用自动压缩（移除 preset 行）',
      controlPresetHint: '会往 preset-standard 里加一行；preset 配置会变成 profile 覆盖层。',
      controlBusy: '正在应用…',
      controlWriteFailed: '更新 agent preset 失败',
      controlEnabled: '自动压缩已启用，按当前上下文执行。',
      controlError: '最近压缩未生效',
      controlDisabled: '已从 agent preset 移除自动压缩行。',
      configTitle: '全局配置',
      configHint: '写入 profile 里本插件的 config 行，保存后插件会按新配置重挂。',
      configUnavailable: '当前客户端不能编辑宿主配置，这里只读。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件已按新配置重挂。',
      saveRefused: '宿主拒绝了这次写入。',
      saveFailed: '保存失败',
      invalidTokens: '上下文必须是正整数。',
      invalidRatios: '阈值必须在 (0, 1] 之间，且警告阈值要小于超限阈值。',
      defaultBudget: '默认上下文（tokens）',
      warnLabel: '警告比例',
      errorLabel: '超限比例',
      meterAria: 'ctx 上下文',
      synced: '已同步',
      inventoryTitle: '工具与提示词',
      inventoryTools: '工具',
      inventoryPrompts: '提示词 section',
      inventoryEmpty: '本会话还没有发起过请求。先发一条消息，再回来打开本页。',
      inventoryRisk: '关闭后该项会从下一次请求里移除，模型行为可能异常；可以在这里一键恢复。',
      sessionSwitch: '会话',
      globalSwitch: '全局',
      confirmDisable: '确认从下一次请求移除？',
      confirm: '确认',
      cancel: '取消',
      restoreAll: '恢复全部',
      restoreConfirm: '将清除：会话开关、全局提示词覆盖、全局工具禁用。确认？',
      tokensShort: 'tok',
      copy: '复制',
      copied: '已复制',
      parameters: '参数（JSON Schema）',
      source: '来源',
      sourceUnknown: '未识别',
      edit: '编辑',
      save: '保存',
      confirmSave: '确认覆盖该提示词 section（全局，下一次请求生效）？',
      resetOriginal: '恢复原文',
      restoreAllPrompts: '恢复全部提示词（全局）',
      overridden: '已覆盖（全局）',
      globalOverridden: '已覆盖（全局）',
      sessionOverridden: '已覆盖（会话）',
      saveSession: '仅保存到本会话',
      saveGlobal: '保存到全局',
      savedSession: '已保存到本会话（下一次请求生效）。',
      savedGlobal: '已保存到全局。',
      confirmGlobal: '确认保存到全局？将影响所有会话并写入 profile。',
      resetSession: '清除会话覆盖',
      editHint: '写入 profile 配置（全局生效），原文保留可恢复。',
      promptTokens: '提示词',
      toolTokens: '工具定义',
      historyTokens: '上文',
      userTokens: '本轮用户对话',
    }

    let sessionService = null

    /** 当前 mainView 保留的会话 id；拿不到时返回 null。 */
    function currentSessionId() {
      const sessions = sessionService
      if (!sessions) return null
      try {
        const state = sessions.list.getSnapshot()
        for (const id of state.ids ?? []) {
          try {
            const info = sessions.retainInfo(id).getSnapshot()
            if (((info && info.retainedBy) || {}).mainView > 0) return id
          } catch {}
        }
      } catch {}
      return null
    }

    /** 订阅会话列表，返回当前选中会话 id（变化时重渲染）。 */
    function useCurrentSession() {
      const [id, setId] = react.useState(() => currentSessionId())
      react.useEffect(() => {
        if (!sessionService) return undefined
        const stop = sessionService.list.subscribe(() => setId(currentSessionId()))
        return () => stop()
      }, [])
      return id
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

    // ── 上下文构成四色（前三色沿用内置 HUD，第 4 色用主题 accent） ─────────────
    const BREAKDOWN_COLORS = {
      system: 'var(--dsw-static-neutral-bluish-400)',
      tools: '#a78bfa',
      history: 'var(--dsw-static-blue-450)',
      user: 'var(--dsw-static-green-400)',
    }

    /** 把宿主返回的四桶构成转成有序图例项；share 按四桶合计算。 */
    function breakdownCategories(t, breakdown) {
      if (!breakdown || typeof breakdown !== 'object') return []
      const system = Number(breakdown.systemTokens) || 0
      const tools = Number(breakdown.toolsTokens) || 0
      const history = Number(breakdown.historyTokens) || 0
      const user = Number(breakdown.userTokens) || 0
      const total = system + tools + history + user
      const rows = [
        { key: 'system', label: t('promptTokens'), tokens: system, color: BREAKDOWN_COLORS.system },
        { key: 'tools', label: t('toolTokens'), tokens: tools, color: BREAKDOWN_COLORS.tools },
        { key: 'history', label: t('historyTokens'), tokens: history, color: BREAKDOWN_COLORS.history },
        { key: 'user', label: t('userTokens'), tokens: user, color: BREAKDOWN_COLORS.user },
      ]
      return rows.map((row) => ({ ...row, share: total > 0 ? row.tokens / total : 0 }))
    }

    /** 分段上下文条：外层长度=已用/上下文，内部颜色=四桶占比；首次渲染从 0 平滑增长。 */
    function SegmentedBar(props) {
      const usedRatio = Math.max(0, Math.min(1, Number(props.usedRatio) || 0))
      const categories = Array.isArray(props.categories) ? props.categories : []
      const filled = categories.filter((row) => row.tokens > 0)
      const signature = `${usedRatio}|${filled.map((row) => `${row.key}:${row.tokens}`).join(',')}`
      const [grown, setGrown] = react.useState(false)
      react.useEffect(() => {
        setGrown(false)
        const frame = requestAnimationFrame(() => setGrown(true))
        return () => cancelAnimationFrame(frame)
      }, [signature])
      if (filled.length === 0) return h(MeterBar, { percent: usedRatio * 100, color: ratioColor(usedRatio) })
      return h(
        'div',
        { style: styles.bar },
        filled.map((row) =>
          h('div', {
            key: row.key,
            'data-ctx-seg': row.key,
            title: `${row.label} · ${compactTokens(row.tokens)} (${formatPercent(row.share)})`,
            style: {
              ...styles.barSegment,
              width: `${(grown ? usedRatio * row.share * 100 : 0).toFixed(3)}%`,
              background: row.color,
              transition: 'width .7s cubic-bezier(.22,.61,.36,1)',
            },
          }),
        ),
      )
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
      barSegment: { height: '100%', minWidth: '2px' },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '12.5px' },
      text: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      emptyText: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      inventorySection: { display: 'flex', flexDirection: 'column', gap: '6px' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', fontWeight: 600, textAlign: 'left' },
      inventoryList: { display: 'flex', flexDirection: 'column', gap: '4px', margin: 0, padding: 0, listStyle: 'none' },
      inventoryItem: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px 0' },
      inventoryRow: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' },
      inventoryHead: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' },
      inventoryName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', whiteSpace: 'nowrap' },
      detailBox: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', borderLeft: '2px solid var(--dsw-alias-border-l2)' },
      detailHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      pre: { margin: 0, padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-secondary)' },
      copyBtn: { border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '1px 8px', fontSize: '11.5px', cursor: 'pointer' },
      promptEditor: { width: '100%', boxSizing: 'border-box', minHeight: '120px', resize: 'vertical', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-primary)' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)' },
      button: { alignSelf: 'flex-start', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '8px', padding: '4px 10px', fontSize: '12.5px', cursor: 'pointer' },
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
      const [grown, setGrown] = react.useState(false)
      react.useEffect(() => {
        setGrown(false)
        const frame = requestAnimationFrame(() => setGrown(true))
        return () => cancelAnimationFrame(frame)
      }, [percent])
      return h(
        'div',
        { style: styles.bar },
        h('div', {
          style: {
            ...styles.barFill,
            width: `${grown ? percent : 0}%`,
            background: props.color || 'var(--dsw-alias-brand-primary)',
            transition: 'width .7s cubic-bezier(.22,.61,.36,1)',
          },
        }),
      )
    }

    function StatChip(props) {
      return h(
        'span',
        { style: styles.chip, title: props.title, 'data-ctx-legend': props.dataKey },
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

    // ── 用量活动事件：会话内容变化（流式输出/发消息/切换会话）时通知刷新，2s 节流 ──
    const usageListeners = new Set()
    let usageTimer = null
    let usageLast = 0
    const USAGE_THROTTLE_MS = 2000
    function emitUsageActivity() {
      for (const listener of usageListeners) {
        try {
          listener()
        } catch {}
      }
    }
    function notifyUsageActivity() {
      const now = Date.now()
      const wait = Math.max(0, USAGE_THROTTLE_MS - (now - usageLast))
      if (wait === 0) {
        usageLast = now
        emitUsageActivity()
        return
      }
      if (usageTimer !== null) return
      usageTimer = setTimeout(() => {
        usageTimer = null
        usageLast = Date.now()
        emitUsageActivity()
      }, wait)
    }
    function subscribeUsageActivity(listener) {
      usageListeners.add(listener)
      return () => usageListeners.delete(listener)
    }
    function useUsageActivity() {
      const [tick, setTick] = react.useState(0)
      react.useEffect(() => subscribeUsageActivity(() => setTick((value) => value + 1)), [])
      return tick
    }

    /** 打开页面时同步一次 /live；重新可见/窗口聚焦或点刷新时再同步，不做定时轮询。 */
    function useLive(path, refreshKey) {
      const [state, setState] = react.useState({ data: null, at: null })
      const reload = react.useCallback(() => {
        fetch(path, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (payload && payload.ok) setState({ data: payload, at: new Date().toISOString() })
          })
          .catch(() => {})
      }, [path])
      react.useEffect(() => {
        reload()
        const onVisible = () => {
          if (document.visibilityState === 'visible') reload()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [reload, refreshKey])
      return [state, reload]
    }

    // ── 输入框下方指示器：与内置 ContextMeter 同排版，点击弹出小明细 ────────
    function CtxDock(props) {
      const t = props.t
      const selectedSession = useCurrentSession()
      const sessionId = props.sessionId || (props.runtime && props.runtime.sessionId) || selectedSession || undefined
      const [data, setData] = react.useState(null)
      const [open, setOpen] = react.useState(false)
      const [hovered, setHovered] = react.useState(false)
      const rootRef = react.useRef(null)
      const usageTick = useUsageActivity()

      const fetchLive = react.useCallback(() => {
        if (!sessionId) return
        fetch(`${STATUS_PATH}/live?sessionId=${encodeURIComponent(String(sessionId))}`, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (payload && payload.ok) setData(payload)
          })
          .catch(() => {})
      }, [sessionId])

      // 打开会话时同步一次触发器；随后补一次延迟同步（等首次装配完成），窗口重新可见/聚焦时也同步。
      // 不是定时轮询：只在挂载、会话变化、可见性变化时各取一次。
      react.useEffect(() => {
        fetchLive()
        const timer = setTimeout(fetchLive, 4000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') fetchLive()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [fetchLive])

      // 点开浮层时再拉一次最新值。
      react.useEffect(() => {
        if (open) fetchLive()
      }, [open, fetchLive])

      // 会话内容变化（节流后）自动刷新触发器。
      react.useEffect(() => {
        if (usageTick > 0) fetchLive()
      }, [usageTick, fetchLive])

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
      const categories = breakdownCategories(t, data && data.breakdown)
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
          h('span', { style: { color } }, label),
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
              h(SegmentedBar, { usedRatio: ratio ?? 0, categories }),
              h(
                'dl',
                { style: meter.rows },
                categories.map((row) =>
                  h(
                    'div',
                    { key: row.key, style: meter.row },
                    h('dt', null, h('span', { style: { ...meter.swatch, background: row.color } }), row.label),
                    h('dd', { style: meter.figures }, `${compactTokens(row.tokens)} · ${formatPercent(row.share)}`),
                  ),
                ),
                h('div', { style: meter.row }, h('dt', null, t('control')), h('dd', { style: meter.figures }, props.controlActive ? t('controlOn') : t('controlOff'))),
              ),
            )
          : null,
      )
    }

    // ── 面板内部区块 ───────────────────────────────────────────────────────
    function OverviewCard(props) {
      const t = props.t
      const live = props.live
      const budget = props.budget || {}
      const latest = props.latest
      const liveUsed = live && typeof live.used === 'number' ? live.used : null
      const liveBudget = live && typeof live.budget === 'number' ? live.budget : null
      const used = liveUsed !== null ? liveUsed : latest && typeof latest.totalTokens === 'number' ? latest.totalTokens : null
      const budgetTokens = liveBudget !== null ? liveBudget : budget.tokens
      const ratio = used !== null && budgetTokens > 0 ? used / budgetTokens : null
      const color = ratioColor(ratio)
      const breakdown = (live && live.breakdown) || (liveUsed === null && latest ? latest.breakdown : null)
      const categories = breakdownCategories(t, breakdown)
      const sub = live ? `${t('synced')} ${formatTime(props.liveAt)}` : latest ? formatTime(latest.at) : undefined
      return h(
        Card,
        { title: t('budget'), sub },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
          h('span', { style: { fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color } }, ratio === null ? '—' : formatPercent(ratio)),
          h('span', { style: { ...styles.cardSub, marginLeft: 0 } }, `${compactTokens(used)} / ${compactTokens(budgetTokens)} ${t('tokens')}`),
        ),
        h(SegmentedBar, { usedRatio: ratio ?? 0, categories }),
        categories.length > 0
          ? h(
              'div',
              { style: styles.chipRow },
              categories.map((row) => h(StatChip, { key: row.key, dataKey: row.key, label: row.label, value: `${compactTokens(row.tokens)} · ${formatPercent(row.share)}`, dot: row.color })),
            )
          : null,
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

    /** 本会话工具 / 提示词 section 清单：两级折叠 + 会话/全局开关 + 展开看原文。 */
    function InventoryCard(props) {
      const t = props.t
      const data = props.data || {}
      const sources = data.sources || {}
      const sourceOf = (name) => (sources.sections && sources.sections[name]) || null
      const toolSourceOf = (name) => (sources.tools && sources.tools[name]) || null
      const inventory = data.inventory
      const disabledSessionTools = Array.isArray(data.disabledSessionTools) ? data.disabledSessionTools : []
      const disabledSessionPrompts = Array.isArray(data.disabledSessionPrompts) ? data.disabledSessionPrompts : []
      const disabledGlobalTools = Array.isArray(data.disabledTools) ? data.disabledTools : []
      const [open, setOpen] = react.useState({ tools: false, prompts: false })
      const [expanded, setExpanded] = react.useState({})
      const [copied, setCopied] = react.useState(null)
      const [pending, setPending] = react.useState(null)
      const [busy, setBusy] = react.useState(null)
      const [editDraft, setEditDraft] = react.useState(null)
      const [promptSave, setPromptSave] = react.useState(null)
      const [promptBusy, setPromptBusy] = react.useState(false)
      const [restorePending, setRestorePending] = react.useState(false)
      const [localEdits, setLocalEdits] = react.useState({})
      const [notice, setNotice] = react.useState(null)

      const post = (body) => {
        setBusy(body)
        fetch(`${STATUS_PATH}/inventory/toggle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((response) => response.json().catch(() => ({})))
          .then(() => {
            setBusy(null)
            setTimeout(() => {
              if (typeof props.reload === 'function') props.reload()
            }, 900)
          })
          .catch(() => setBusy(null))
      }

      const toggle = (kind, name, layer, enabled) => {
        if (enabled) {
          post({ kind, name, layer, enabled: true, ...(layer === 'session' && props.sessionId ? { sessionId: props.sessionId } : {}) })
          return
        }
        setPending({ kind, name, layer })
      }

      const confirm = () => {
        if (!pending) return
        post({ ...pending, enabled: false, ...(pending.layer === 'session' && props.sessionId ? { sessionId: props.sessionId } : {}) })
        setPending(null)
      }

      const restore = () => {
        fetch(`${STATUS_PATH}/inventory/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ layer: 'all' }),
        })
          .then((response) => response.json().catch(() => ({})))
          .then(() => {
            setRestorePending(false)
            setTimeout(() => props.reload && props.reload(), 1800)
          })
          .catch(() => setRestorePending(false))
      }

      const copy = (key, text) => {
        const done = () => {
          setCopied(key)
          setTimeout(() => setCopied(null), 1200)
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).then(done).catch(done)
        } else done()
      }

      const postPrompt = (suffix, body) => {
        setPromptBusy(true)
        fetch(`${STATUS_PATH}/inventory/prompt${suffix}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((response) => response.json().catch(() => ({})))
          .then(() => {
            setPromptBusy(false)
            setEditDraft(null)
            setPromptSave(null)
            if (suffix === '') { setLocalEdits((prev) => ({ ...prev, [body.name]: body.text })); setNotice(t('savedGlobal')) }
            else if (body && typeof body.name === 'string') setLocalEdits((prev) => { const next = { ...prev }; delete next[body.name]; return next })
            else setLocalEdits({})
            setTimeout(() => props.reload && props.reload(), 1200)
          })
          .catch(() => setPromptBusy(false))
      }

      const postSessionPrompt = (name, text) => {
        setPromptBusy(true)
        fetch(`${STATUS_PATH}/inventory/prompt/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, text, ...(props.sessionId ? { sessionId: props.sessionId } : {}) }),
        })
          .then((response) => response.json().catch(() => ({})))
          .then(() => {
            setPromptBusy(false)
            setEditDraft(null)
            setPromptSave(null)
            setLocalEdits((prev) => ({ ...prev, [name]: text }))
            setNotice(t('savedSession'))
            setTimeout(() => props.reload && props.reload(), 800)
          })
          .catch(() => setPromptBusy(false))
      }

      const postSessionPromptReset = (name) => {
        setPromptBusy(true)
        fetch(`${STATUS_PATH}/inventory/prompt/session/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, ...(props.sessionId ? { sessionId: props.sessionId } : {}) }),
        })
          .then((response) => response.json().catch(() => ({})))
          .then(() => {
            setPromptBusy(false)
            setLocalEdits((prev) => {
              const next = { ...prev }
              delete next[name]
              return next
            })
            setNotice(null)
            setTimeout(() => props.reload && props.reload(), 800)
          })
          .catch(() => setPromptBusy(false))
      }

      const switchNode = (kind, name, layer, enabled) => {
        const key = `${kind}:${name}:${layer}`
        const confirming = pending && pending.kind === kind && pending.name === name && pending.layer === layer
        const working = busy && busy.kind === kind && busy.name === name && busy.layer === layer
        if (confirming) {
          return h(
            'span',
            { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } },
            h('button', { type: 'button', style: styles.copyBtn, onClick: confirm, 'data-ctx-confirm': '1' }, t('confirm')),
            h('button', { type: 'button', style: styles.copyBtn, onClick: () => setPending(null) }, t('cancel')),
          )
        }
        return h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled,
            'data-ctx-switch': key,
            title: `${t(layer === 'global' ? 'globalSwitch' : 'sessionSwitch')}${enabled ? ' ✓' : ''}`,
            style: {
              width: '30px',
              height: '16px',
              borderRadius: '999px',
              border: 'none',
              padding: '1px',
              cursor: working ? 'wait' : 'pointer',
              background: enabled ? 'var(--dsw-static-green-500)' : 'var(--dsw-alias-interactive-bg-hover)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: enabled ? 'flex-end' : 'flex-start',
              transition: 'background .15s ease',
              opacity: working ? 0.5 : 1,
            },
            onClick: () => toggle(kind, name, layer, !enabled),
          },
          h('span', { style: { width: '14px', height: '14px', borderRadius: '50%', background: '#fff', opacity: enabled ? 1 : 0.85 } }),
        )
      }

      const chevron = (isOpen) => h('span', { style: { display: 'inline-block', width: '10px', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' } }, '›')

      const details = (key, text, extra) => {
        const openKey = expanded[key]
        if (!openKey) return null
        return h(
          'div',
          { style: styles.detailBox },
          extra || null,
          h(
            'div',
            { style: styles.detailHead },
            h('span', { style: styles.cardSub }, t('copy')),
            h('button', { type: 'button', style: styles.copyBtn, onClick: () => copy(key, text) }, copied === key ? t('copied') : t('copy')),
          ),
          h('pre', { style: styles.pre, 'data-ctx-detail': key }, text),
        )
      }

      const tools = inventory && Array.isArray(inventory.tools) ? inventory.tools.slice() : []
      for (const name of [...disabledSessionTools, ...disabledGlobalTools]) {
        if (!tools.some((tool) => tool.name === name)) tools.push({ name, tokens: null })
      }
      const sections = inventory && Array.isArray(inventory.sections) ? inventory.sections.slice() : []
      for (const name of disabledSessionPrompts) {
        if (!sections.some((section) => section.name === name)) sections.push({ name, tokens: null, text: '' })
      }

      const toolRow = (tool) => {
        const key = `tool:${tool.name}`
        const schemaText = tool.parameters ? JSON.stringify(tool.parameters, null, 2) : ''
        const isOpen = Boolean(expanded[key])
        return h(
          'li',
          { key, style: styles.inventoryItem },
          h(
            'div',
            { style: styles.inventoryRow },
            h(
              'button',
              { type: 'button', style: styles.inventoryHead, 'data-ctx-expand': key, 'aria-expanded': isOpen, onClick: () => setExpanded({ ...expanded, [key]: !isOpen }) },
              chevron(isOpen),
              h('span', { style: styles.inventoryName }, tool.name),
              tool.tokens !== null && tool.tokens !== undefined ? h('span', { style: styles.cardSub }, `~${compactTokens(tool.tokens)} ${t('tokensShort')}`) : null,
            ),
            h(
              'span',
              { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', flex: 'none' } },
              h('span', { style: styles.cardSub }, t('sessionSwitch')), switchNode('tool', tool.name, 'session', !disabledSessionTools.includes(tool.name)),
              h('span', { style: styles.cardSub }, t('globalSwitch')), switchNode('tool', tool.name, 'global', !disabledGlobalTools.includes(tool.name)),
            ),
          ),
          isOpen
            ? details(
                key,
                tool.description || '',
                schemaText
                  ? h(
                      'div',
                      { key: 'schema', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                      h(
                        'div',
                        { style: styles.detailHead },
                        h('span', { style: styles.cardSub }, t('parameters')),
                        h('button', { type: 'button', style: styles.copyBtn, onClick: () => copy(`${key}:schema`, schemaText) }, copied === `${key}:schema` ? t('copied') : t('copy')),
                      ),
                      h('pre', { style: styles.pre, 'data-ctx-schema': key }, schemaText),
                    )
                  : null,
              )
            : null,
        )
      }

      const promptRow = (section) => {
        const key = `prompt:${section.name}`
        const isOpen = Boolean(expanded[key])
        const editing = editDraft && editDraft.name === section.name
        const hasLocal = Object.prototype.hasOwnProperty.call(localEdits, section.name)
        const effectiveText = hasLocal ? localEdits[section.name] : section.text || ''
        const dirty = hasLocal || section.overridden || (section.originalText !== undefined && section.originalText !== section.text)
        const editorNode = editing
          ? h('textarea', {
              style: styles.promptEditor,
              rows: 8,
              value: editDraft.text,
              'data-ctx-prompt-editor': section.name,
              onChange: (event) => setEditDraft({ ...editDraft, text: event.target.value }),
            })
          : h('div', { style: styles.detailBox },
              h('div', { style: styles.detailHead },
                h('span', { style: styles.cardSub }, dirty ? (section.sessionOverridden ? t('sessionOverridden') : t('globalOverridden')) : t('editHint')),
                h('span', { style: { ...styles.cardSub, fontFamily: 'ui-monospace, monospace', maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: sourceOf(section.name) || t('sourceUnknown') }, `${t('source')}: ${sourceOf(section.name) || t('sourceUnknown')}`),
                h('span', { style: { display: 'inline-flex', gap: '6px' } },
                  h('button', { type: 'button', style: styles.copyBtn, 'data-ctx-prompt-edit': section.name, onClick: () => { setEditDraft({ name: section.name, text: effectiveText }); setPromptSave(null) }, disabled: promptBusy }, t('edit')),
                  dirty ? h('button', { type: 'button', style: styles.copyBtn, 'data-ctx-prompt-reset': section.name, onClick: () => (section.sessionOverridden ? postSessionPromptReset(section.name) : postPrompt('/reset', { name: section.name })), disabled: promptBusy }, section.sessionOverridden ? t('resetSession') : t('resetOriginal')) : null,
                  h('button', { type: 'button', style: styles.copyBtn, onClick: () => copy(key, effectiveText) }, copied === key ? t('copied') : t('copy')),
                ),
              ),
              h('pre', { style: styles.pre, 'data-ctx-detail': key }, effectiveText),
            )
        return h(
          'li',
          { key, style: styles.inventoryItem },
          h(
            'div',
            { style: styles.inventoryRow },
            h(
              'button',
              { type: 'button', style: styles.inventoryHead, 'data-ctx-expand': key, 'aria-expanded': isOpen, onClick: () => setExpanded({ ...expanded, [key]: !isOpen }) },
              chevron(isOpen),
              h('span', { style: styles.inventoryName }, section.name),
              dirty ? h('span', { style: styles.cardSub }, section.sessionOverridden ? t('sessionOverridden') : t('globalOverridden')) : null,
              section.tokens !== null && section.tokens !== undefined ? h('span', { style: styles.cardSub }, `~${compactTokens(section.tokens)} ${t('tokensShort')}`) : null,
            ),
            h(
              'span',
              { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', flex: 'none' } },
              h('span', { style: styles.cardSub }, t('sessionSwitch')), switchNode('prompt', section.name, 'session', !disabledSessionPrompts.includes(section.name)),
            ),
          ),
          isOpen ? editorNode : null,
          isOpen && notice ? h('p', { style: styles.cardSub }, notice) : null,
          isOpen && editing
            ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                promptSave === section.name
                  ? [h('span', { key: 'q', style: styles.cardSub }, t('confirmGlobal')),
                     h('button', { key: 'ok', type: 'button', style: styles.copyBtn, 'data-ctx-prompt-confirm': section.name, onClick: () => postPrompt('', { name: section.name, text: editDraft.text }), disabled: promptBusy }, t('confirm')),
                     h('button', { key: 'no', type: 'button', style: styles.copyBtn, onClick: () => setPromptSave(null) }, t('cancel'))]
                  : [h('button', { key: 'session', type: 'button', style: styles.copyBtn, 'data-ctx-prompt-save-session': section.name, onClick: () => postSessionPrompt(section.name, editDraft.text), disabled: promptBusy }, t('saveSession')),
                     h('button', { key: 'save', type: 'button', style: styles.copyBtn, 'data-ctx-prompt-save': section.name, onClick: () => setPromptSave(section.name), disabled: promptBusy }, t('saveGlobal')),
                     h('button', { key: 'cancel', type: 'button', style: styles.copyBtn, onClick: () => { setEditDraft(null); setPromptSave(null) } }, t('cancel')),
                     h('span', { key: 'hint', style: styles.cardSub }, t('editHint'))],
              )
            : null,
        )
      }

      const empty = tools.length === 0 && sections.length === 0
      return h(
        Card,
        { title: t('inventoryTitle'), sub: data.sessionId ? String(data.sessionId).slice(0, 8) : undefined },
        empty ? h('p', { style: styles.emptyText }, t('inventoryEmpty')) : null,
        !empty
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
              h(
                'div',
                { style: styles.inventorySection },
                h(
                  'button',
                  { type: 'button', style: styles.sectionHead, 'data-ctx-section': 'tools', onClick: () => setOpen({ ...open, tools: !open.tools }) },
                  chevron(open.tools), t('inventoryTools'), h('span', { style: styles.cardSub }, String(tools.length)),
                ),
                open.tools ? h('ul', { style: styles.inventoryList }, tools.map(toolRow)) : null,
              ),
              h(
                'div',
                { style: styles.inventorySection },
                h(
                  'button',
                  { type: 'button', style: styles.sectionHead, 'data-ctx-section': 'prompts', onClick: () => setOpen({ ...open, prompts: !open.prompts }) },
                  chevron(open.prompts), t('inventoryPrompts'), h('span', { style: styles.cardSub }, String(sections.length)),
                ),
                open.prompts ? h('ul', { style: styles.inventoryList }, sections.map(promptRow)) : null,
              ),
              h('p', { style: styles.text }, t('inventoryRisk')),
              restorePending
                ? h(
                    'div',
                    { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                    h('span', { style: styles.cardSub }, t('restoreConfirm')),
                    h('button', { type: 'button', style: styles.button, 'data-ctx-restore-confirm': '1', onClick: restore }, t('confirm')),
                    h('button', { type: 'button', style: styles.button, onClick: () => setRestorePending(false) }, t('cancel')),
                  )
                : h('button', { type: 'button', style: styles.button, 'data-ctx-restore-all': '1', onClick: () => setRestorePending(true) }, t('restoreAll')),
            )
          : null,
        h('button', { key: 'reload', type: 'button', style: styles.button, onClick: props.reload }, t('refresh')),
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
        control.lastError
          ? h('p', { style: styles.error, 'data-ctx-lasterror': '1' }, `${t('controlError')}: ${control.lastError}`)
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
        Card,
        { title: t('configTitle'), sub: editable ? undefined : t('configUnavailable') },
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
      const activeSession = useCurrentSession()
      const usageTick = useUsageActivity()
      const livePath = activeSession ? `${STATUS_PATH}/live?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/live`
      const inventoryPath = activeSession ? `${STATUS_PATH}/inventory?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/inventory`
      const [liveState, reloadLive] = useLive(livePath, usageTick)
      const [invState, reloadInv] = useLive(inventoryPath, usageTick)
      const live = liveState.data
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
        // 概览卡占满一行；控制卡 + 全局配置卡并排两列。
        children.push(h(OverviewCard, { key: 'overview', t, budget, latest, live, liveAt: liveState.at, controlActive: Boolean(control.active) }))
        children.push(
          h('div', { key: 'cols', style: styles.cols }, h(ControlSection, { t, control, onToggled: load }), h(ConfigSection, { t, budget, editable: Boolean(data.configEditable), onSaved: load })),
        )
        children.push(h(InventoryCard, { key: 'inventory', t, data: invState.data, reload: reloadInv, sessionId: activeSession }))
        children.push(h('button', { key: 'refresh', type: 'button', style: styles.button, onClick: () => { load(); reloadLive(); reloadInv() } }, t('refresh')))
      }
      return h('div', { style: styles.root, 'data-ctx-panel': '1' }, children)
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

      // 事件驱动刷新：监听会话区域的 DOM 变化（流式输出、消息更新、切换会话），2s 节流。
      // 忽略本插件自己的 UI（dock/面板），避免自触发循环。
      ctx.effect(() => {
        if (typeof MutationObserver !== 'function' || !document.body) return () => {}
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
            if (target && typeof target.closest === 'function' && (target.closest('[data-ctx-dock]') || target.closest('[data-ctx-panel]'))) continue
            notifyUsageActivity()
            return
          }
        })
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
        return () => observer.disconnect()
      }, 'ctx-mon-and-con: usage activity observer')
      if (typeof ctx.inject === 'function') ctx.inject(['sessions'], (sub) => {
        sessionService = sub?.sessions ?? null
        if (typeof sub.effect === 'function') sub.effect(() => () => { sessionService = null }, 'ctx-mon-and-con: sessions presence')
      })
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
