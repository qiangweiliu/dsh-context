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
      pageTitle: 'Context monitor',
      versionLabel: 'Plugin version',
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
      triggerAt: 'Trigger at',
      triggerLabel: 'Trigger ratio',
      invalidTrigger: 'Trigger ratio must be in (0, 1].',
      triggerHint: 'Auto-compaction triggers when usage reaches this share of the budget (1 = only at the limit; 0.75 = pre-compress at the warn ratio).',
      targetAt: 'Target at',
      targetLabel: 'Target ratio',
      invalidTarget: 'Target ratio must be in (0, 1) and below the trigger ratio.',
      compacting: 'Compacting…',
      compactingHint: 'Compaction is running; the next request may wait a moment.',
      recent: 'Recent /ctx measurements',
      loading: 'Loading…',
      refresh: 'Refresh',
      collapse: 'Collapse',
      expand: 'Expand',
      lastDelta: 'Since last sync',
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
      compactLog: 'Compaction log',
      compactSuccess: 'success',
      compactFailure: 'failed',
      compactNoLogs: 'No compaction records yet.',
      roundsUnit: 'round(s)',
      controlEnable: 'Enable auto-compaction (writes the agent preset)',
      controlDisable: 'Disable auto-compaction (removes the preset row)',
      controlPresetHint: 'Writes one row into preset-standard; the preset config becomes a profile override.',
      controlBusy: 'Applying…',
      controlWriteFailed: 'Could not update the agent preset',
      controlEnabled: 'Auto-compaction is now enforced with this context limit.',
      controlError: 'Last compaction issue',
      compositionHint: 'Composition is a heuristic estimate; provider pressure may differ.',
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
      defaultBudgetShort: 'Default limit',
      warnLabel: 'Warn ratio',
      errorLabel: 'Error ratio',
      meterAria: 'ctx context limit',
      synced: 'synced',
      inventoryTitle: 'Tools & prompt sections',
      inventoryTools: 'Tools',
      inventoryPrompts: 'Prompt sections',
      inventoryEmpty: 'No request yet in this session. Send one message, then reopen this page.',
      inventoryRisk: 'Disabling removes the item from the next request. The model may behave unexpectedly; you can restore everything here.',
      onlyEnabled: 'Enabled only',
      noneEnabled: 'No enabled items.',
      inventoryLoadFailed: 'Could not load tools / prompt sections',
      openPanel: 'Open full panel',
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
      tabsOverview: 'Overview',
      tabsTrend: 'Trend',
      tabsEvents: 'Events',
      tabsSettings: 'Settings',
      range7: '7 days',
      range30: '30 days',
      rangeAll: 'All',
      kpiSessions: 'Sessions',
      kpiTokens: 'Tokens',
      kpiCache: 'Cache hit',
      kpiCost: 'Cost (est.)',
      kpiTools: 'Tool calls',
      kpiActive: 'Active time',
      kpiCompactions: 'Compactions',
      costUnknown: 'no price for this model',
      costEstimated: 'estimated from known model prices',
      readFailures: '{count} sessions could not be read',
      coverage: 'Scanned {scanned}/{total} sessions',
      coverageShort: '{scanned}/{total} scanned',
      dailyTitle: 'Tokens per day',
      heatmapTitle: 'Activity',
      sessionsTitle: 'Recent sessions',
      searchSessions: 'Search title / workspace / id',
      noSessions: 'No sessions in this range',
      sortRecent: 'Newest',
      sortTokens: 'Tokens',
      selectSession: 'View trend',
      trendTitle: 'Request context trend',
      trendPrompt: 'Prompt',
      trendOutput: 'Output',
      trendCompaction: 'Compaction',
      trendNoData: 'No completed requests yet',
      eventsTitle: 'Compaction & injections',
      eventAll: 'All',
      eventSuccess: 'Success',
      eventFailure: 'Failure',
      eventCompaction: 'Compaction',
      eventInject: 'Injection',
      noEvents: 'No matching events',
      settingsTitle: 'Settings',
      sessionLabel: 'Session',
      turnsLabel: 'Turns',
      requestsLabel: 'Requests',
      lastActive: 'Last active',
      analyticsLoading: 'Loading session analytics…',
      analyticsError: 'Analytics unavailable',
      budgetLine: 'Budget',
      targetLine: 'Target',
      beforeAfter: 'Before → after',
      roundsLabel: 'Rounds',
      durationLabel: 'Duration',
      showMore: 'Show more',
      showLess: 'Show less',
    }

    const zh = {
      nav: '上下文长度',
      panel: 'ctx',
      ctxBrand: 'ctx',
      title: '上下文长度',
      pageTitle: '上下文监控',
      versionLabel: '插件版本',
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
      triggerAt: '触发阈值',
      triggerLabel: '触发比例',
      invalidTrigger: '触发比例必须在 (0, 1] 之间。',
      triggerHint: '用量达到预算的这个比例时自动压缩（1 = 到上限才触发；0.75 = 到警告比例就预压缩）。',
      targetAt: '目标阈值',
      targetLabel: '目标比例',
      invalidTarget: '目标比例必须在 (0, 1) 之间，且小于触发比例。',
      compacting: '压缩中…',
      compactingHint: '正在压缩历史；下一次请求可能会等待片刻。',
      recent: '最近的 /ctx 测量',
      loading: '加载中…',
      refresh: '刷新',
      collapse: '收起',
      expand: '展开',
      lastDelta: '较上次同步',
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
      compactLog: '压缩记录',
      compactSuccess: '成功',
      compactFailure: '失败',
      compactNoLogs: '还没有压缩记录。',
      roundsUnit: '轮',
      controlEnable: '启用自动压缩（写入 agent preset）',
      controlDisable: '停用自动压缩（移除 preset 行）',
      controlPresetHint: '会往 preset-standard 里加一行；preset 配置会变成 profile 覆盖层。',
      controlBusy: '正在应用…',
      controlWriteFailed: '更新 agent preset 失败',
      controlEnabled: '自动压缩已启用，按当前上下文执行。',
      controlError: '最近压缩未生效',
      compositionHint: '构成是启发式估算，与 provider 压力口径可能不同',
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
      defaultBudgetShort: '默认上限',
      warnLabel: '警告比例',
      errorLabel: '超限比例',
      meterAria: 'ctx 上下文',
      synced: '已同步',
      inventoryTitle: '工具与提示词',
      inventoryTools: '工具',
      inventoryPrompts: '提示词',
      inventoryEmpty: '本会话还没有发起过请求。先发一条消息，再回来打开本页。',
      inventoryRisk: '关闭后该项会从下一次请求里移除，模型行为可能异常；可以在这里一键恢复。',
      onlyEnabled: '仅看已启用',
      noneEnabled: '没有启用的项。',
      inventoryLoadFailed: '加载工具 / 提示词失败',
      openPanel: '打开完整面板',
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
      tabsOverview: '概览',
      tabsTrend: '趋势',
      tabsEvents: '事件',
      tabsSettings: '设置',
      range7: '近 7 天',
      range30: '近 30 天',
      rangeAll: '全部',
      kpiSessions: '会话数',
      kpiTokens: '累计 tokens',
      kpiCache: '缓存命中',
      kpiCost: '费用（估算）',
      kpiTools: '工具调用',
      kpiActive: '活跃时长',
      kpiCompactions: '压缩次数',
      costUnknown: '该模型暂无价格',
      costEstimated: '按已知模型价格估算',
      readFailures: '{count} 个会话读取失败',
      coverage: '已扫描 {scanned}/{total} 个会话',
      coverageShort: '{scanned}/{total} 已扫描',
      dailyTitle: '每日 tokens',
      heatmapTitle: '活跃度',
      sessionsTitle: '最近会话',
      searchSessions: '搜索标题 / 工作区 / id',
      noSessions: '该范围内没有会话',
      sortRecent: '最近',
      sortTokens: 'Tokens',
      selectSession: '查看趋势',
      trendTitle: '请求上下文趋势',
      trendPrompt: '请求',
      trendOutput: '输出',
      trendCompaction: '压缩',
      trendNoData: '还没有完成的请求',
      eventsTitle: '压缩与注入事件',
      eventAll: '全部',
      eventSuccess: '成功',
      eventFailure: '失败',
      eventCompaction: '压缩',
      eventInject: '注入',
      noEvents: '没有匹配的事件',
      settingsTitle: '设置',
      sessionLabel: '会话',
      turnsLabel: '轮数',
      requestsLabel: '请求数',
      lastActive: '最近活动',
      analyticsLoading: '正在加载会话统计…',
      analyticsError: '统计暂不可用',
      budgetLine: '预算',
      targetLine: '目标',
      beforeAfter: '压缩前 → 后',
      roundsLabel: '轮次',
      durationLabel: '耗时',
      showMore: '展开更多',
      showLess: '收起',
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

    function formatDurationMs(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number < 0) return '—'
      if (number < 1000) return `${Math.round(number)}ms`
      if (number < 60000) return `${(number / 1000).toFixed(1)}s`
      if (number < 3600000) return `${Math.round(number / 60000)}m`
      return `${(number / 3600000).toFixed(1)}h`
    }
    /** 会话 id 的短标签：去掉 "session-" 前缀，避免所有 id 都显示成 session-。 */
    function shortSessionId(value) {
      const text = String(value)
      if (text.startsWith('session-')) return text.slice(8, 20)
      return text.slice(0, 12)
    }

    function ratioColor(ratio, warnAt = 0.75, errorAt = 0.9) {
      if (ratio === null || ratio === undefined) return 'var(--dsw-alias-label-tertiary)'
      if (ratio >= errorAt) return 'var(--dsw-alias-state-error-primary)'
      if (ratio >= warnAt) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-brand-primary)'
    }

    /** ok / warn / error —— 与 ratioColor 的阈值一致，用于状态 badge 与文字。 */
    function ratioState(ratio, warnAt = 0.75, errorAt = 0.9) {
      if (ratio === null || ratio === undefined) return 'ok'
      if (ratio >= errorAt) return 'error'
      if (ratio >= warnAt) return 'warn'
      return 'ok'
    }

    function StatusBadge(props) {
      const t = props.t
      const state = props.state || 'ok'
      const label = props.label || (state === 'error' ? t('statusError') : state === 'warn' ? t('statusWarn') : t('statusOk'))
      const style = state === 'error' ? styles.badgeError : state === 'warn' ? styles.badgeWarn : styles.badgeOk
      return h('span', { style: { ...styles.badge, ...style }, 'data-ctx-status': state }, h('i', { style: { ...styles.dot, width: '6px', height: '6px', borderRadius: '999px', background: 'currentColor' } }), label)
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
      if (filled.length === 0) return h(MeterBar, { percent: usedRatio * 100, color: ratioColor(usedRatio, props.warnAt, props.errorAt) })
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
      pageInner: { maxWidth: '1040px', margin: '0 auto', padding: '24px clamp(16px, 4vw, 40px) 48px', display: 'flex', flexDirection: 'column', gap: '14px' },
      root: { display: 'flex', flexDirection: 'column', gap: '12px' },
      titleRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '22px', fontWeight: 600, lineHeight: '30px', letterSpacing: '-0.01em' },
      versionChip: { display: 'inline-flex', alignItems: 'center', borderRadius: '999px', border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', padding: '1px 8px', fontSize: '11.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      subtitle: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      cols: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' },
      card: {
        minWidth: 'min(260px, 100%)',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      cardFill: { flex: '1 1 320px', minWidth: 'min(260px, 100%)' },
      cardHead: { display: 'flex', alignItems: 'center', gap: '8px' },
      cardTitle: { margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      cardToggle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', flex: 'none', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', padding: 0, borderRadius: '4px', cursor: 'pointer', fontSize: '14px', lineHeight: 1 },
      // ── 压缩记录（控制卡内可折叠列表，一条一行） ────────────────────────
      logBox: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px', paddingTop: '8px', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      logToggle: { display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'stretch', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: '12.5px', fontWeight: 600, textAlign: 'left' },
      logList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '260px', overflow: 'auto' },
      logItem: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      logLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 },
      logTime: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      logMain: { flex: '1 1 auto', minWidth: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' },
      logSession: { marginLeft: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
      logMessage: { margin: 0, fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      cardSub: { marginLeft: 'auto', fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover)', padding: '1px 6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', minWidth: 0 },
      chipStrong: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums', fontSize: '12.5px' },
      dot: { width: '8px', height: '8px', borderRadius: '2px', display: 'inline-block' },
      bar: { background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: '999px', height: '8px', display: 'flex', overflow: 'hidden' },
      barFill: { borderRadius: '999px', height: '100%', minWidth: '2px' },
      barSegment: { height: '100%', minWidth: '2px' },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '12.5px' },
      text: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      emptyText: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      inventorySection: { display: 'flex', flexDirection: 'column', gap: '6px' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', fontWeight: 600, textAlign: 'left' },
      inventoryList: { display: 'flex', flexDirection: 'column', gap: '4px', margin: 0, padding: 0, listStyle: 'none' },
      inventoryItem: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px 0' },
      inventoryRow: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', minWidth: 0 },
      inventoryHead: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' },
      inventoryName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      detailBox: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', borderLeft: '2px solid var(--dsw-alias-border-l2)' },
      detailHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      pre: { margin: 0, padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--dsw-alias-label-secondary)' },
      copyBtn: { border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '1px 8px', fontSize: '11.5px', cursor: 'pointer' },
      promptEditor: { width: '100%', boxSizing: 'border-box', minHeight: '120px', resize: 'vertical', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-primary)' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)' },
      button: { alignSelf: 'flex-start', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: '8px', padding: '4px 10px', fontSize: '12.5px', cursor: 'pointer' },
      buttonPrimary: { background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))', border: '0.5px solid transparent', color: 'var(--dsw-alias-label-primary-foreground, #fff)', fontWeight: 500 },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', minWidth: 0 },
      configGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 12px' },
      label: { color: 'var(--dsw-alias-label-secondary)' },
      input: { width: '100%', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', padding: '5px 9px', fontSize: '12.5px' },
      // ── 概览 hero / 环形图 / KPI / 图例 ───────────────────────────────────
      heroBody: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' },
      ringWrap: { position: 'relative', width: '104px', height: '104px', flex: 'none' },
      ringSvg: { width: '104px', height: '104px', transform: 'rotate(-90deg)' },
      ringCenter: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px' },
      ringPercent: { fontSize: '21px', fontWeight: 600, lineHeight: '25px', fontVariantNumeric: 'tabular-nums' },
      ringLabel: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)' },
      kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: '8px', flex: '1 1 260px', minWidth: '210px' },
      kpi: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', minWidth: 0 },
      kpiLabel: { fontSize: '10.5px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiValue: { fontSize: '15px', lineHeight: '21px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      kpiSub: { fontSize: '10.5px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      legend: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '5px 14px', margin: '2px 0 0', padding: 0 },
      legendItem: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      legendName: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      legendValue: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' },
      // ── 状态 badge / 阈值 chip ───────────────────────────────────────────
      badge: { display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 600, lineHeight: '18px', border: '0.5px solid transparent', whiteSpace: 'nowrap' },
      badgeOk: { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'var(--dsw-alias-state-success-primary)' },
      badgeWarn: { color: 'var(--dsw-alias-state-warn-primary)', borderColor: 'var(--dsw-alias-state-warn-primary)' },
      badgeError: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
      thresholds: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      thresholdChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: '6px', padding: '0 7px', fontVariantNumeric: 'tabular-nums' },
      // ── 加载 / 空态 / 错误态 ─────────────────────────────────────────────
      skeletonStack: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px 0' },
      skeleton: { height: '12px', borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover)' },
      emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '18px 12px', border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: '10px', textAlign: 'center' },
      // ── 工具与提示词：筛选 / 行 ──────────────────────────────────────────
      filterRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      filterCount: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      filterToggle: { display: 'inline-flex', alignItems: 'center', gap: '5px', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', borderRadius: '999px', padding: '1px 9px', fontSize: '11.5px', lineHeight: '18px', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' },
      filterToggleOn: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)' },
      // ── 配置卡：字段行 / 反馈 ────────────────────────────────────────────
      fieldLabelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' },
      fieldUnit: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      actionRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      successText: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-state-success-primary)' },
    }

    Object.assign(styles, {
      headerCard: { position: 'sticky', top: 0, zIndex: 3, background: 'var(--dsw-alias-bg-base)', padding: '4px 0 8px', display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '0.5px solid var(--dsw-alias-border-l1)' },
      headerRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      headerSpacer: { flex: '1 1 auto' },
      tabs: { display: 'flex', gap: '2px', flexWrap: 'wrap', background: 'var(--dsw-alias-interactive-bg-hover)', padding: '2px', borderRadius: '9px', alignSelf: 'flex-start' },
      tab: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', borderRadius: '7px', padding: '4px 12px', fontSize: '12.5px', lineHeight: '18px', cursor: 'pointer' },
      tabActive: { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, boxShadow: '0 0.5px 2px rgba(0,0,0,.08)' },
      rangeRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      rangeBtn: { border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', borderRadius: '999px', padding: '1px 10px', fontSize: '11.5px', lineHeight: '19px', cursor: 'pointer' },
      rangeBtnOn: { background: 'var(--dsw-alias-brand-primary)', borderColor: 'transparent', color: 'var(--dsw-alias-label-primary-foreground, #fff)' },
      kpiBand: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(124px, 1fr))', gap: '10px' },
      kpiCard: { padding: '10px 12px', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 },
      kpiCardLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiCardValue: { fontSize: '19px', lineHeight: '26px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiCardSub: { fontSize: '10.5px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      chartWrap: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
      chartBars: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '92px', paddingTop: '6px', overflowX: 'auto' },
      chartBarCol: { flex: '1 1 0', minWidth: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' },
      chartBar: { width: '100%', maxWidth: '34px', borderRadius: '4px 4px 2px 2px', background: 'var(--dsw-alias-brand-primary)', minHeight: '2px', opacity: 0.85 },
      chartBarZero: { background: 'var(--dsw-alias-interactive-bg-hover)' },
      chartLabel: { fontSize: '9.5px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      heatGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18px, 1fr))', gap: '3px' },
      heatCell: { aspectRatio: '1 / 1', borderRadius: '3px', background: 'var(--dsw-alias-interactive-bg-hover)', minWidth: '14px' },
      sessionList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px' },
      sessionCard: { textAlign: 'left', border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', cursor: 'pointer', color: 'inherit', minWidth: 0 },
      sessionCardOn: { borderColor: 'var(--dsw-alias-brand-primary)' },
      sessionTitle: { margin: 0, fontSize: '12.5px', fontWeight: 600, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sessionMeta: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sessionStats: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      trendWrap: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
      trendScroll: { overflowX: 'auto', paddingBottom: '4px' },
      trendCols: { display: 'flex', alignItems: 'flex-end', gap: '3px', minHeight: '130px', minWidth: '100%' },
      trendCol: { flex: '1 0 18px', maxWidth: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', position: 'relative' },
      trendPrompt: { width: '100%', borderRadius: '3px 3px 0 0', background: 'var(--dsw-alias-brand-primary)', minHeight: '2px' },
      trendOutput: { width: '100%', borderRadius: '0 0 2px 2px', background: 'var(--dsw-alias-state-warn-primary)', minHeight: '1px' },
      trendMarker: { position: 'absolute', top: '-2px', width: '100%', height: '3px', borderRadius: '2px', background: 'var(--dsw-alias-state-error-primary)' },
      legendInline: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      filterBar: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      eventList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0' },
      eventItem: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)', minWidth: 0 },
      eventKind: { flex: 'none', fontSize: '10px', fontWeight: 600, borderRadius: '4px', padding: '0 5px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)' },
      eventMain: { flex: '1 1 auto', minWidth: 0, fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' },
      eventAside: { flex: 'none', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      searchInput: { width: '100%', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', padding: '5px 9px', fontSize: '12px' },
      banner: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
    })

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

    /** 大号环形图：外圈背景 + 进度弧，中心显示百分比/已用。 */
    function BigRing(props) {
      const percent = Math.max(0, Math.min(100, Number(props.percent) || 0))
      const radius = 46
      const circumference = 2 * Math.PI * radius
      return h(
        'div',
        { style: styles.ringWrap, 'data-ctx-ring': String(Math.round(percent)), title: props.title },
        h(
          'svg',
          { viewBox: '0 0 104 104', width: 104, height: 104, style: styles.ringSvg, 'aria-hidden': true },
          h('circle', { cx: 52, cy: 52, r: radius, fill: 'none', stroke: 'var(--dsw-alias-interactive-bg-hover)', strokeWidth: 9 }),
          h('circle', {
            cx: 52,
            cy: 52,
            r: radius,
            fill: 'none',
            stroke: props.color || 'var(--dsw-alias-brand-primary)',
            strokeWidth: 9,
            strokeLinecap: 'round',
            strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
            style: { transition: 'stroke-dasharray .6s cubic-bezier(.22,.61,.36,1), stroke .2s ease' },
          }),
        ),
        h(
          'div',
          { style: styles.ringCenter },
          h('span', { style: { ...styles.ringPercent, color: props.color } }, percent === null ? '—' : `${Math.round(percent)}%`),
          h('span', { style: styles.ringLabel }, props.label || ''),
        ),
      )
    }

    /** 四色图例：色点 + 名称 + 右对齐的数值/占比。 */
    function LegendGrid(props) {
      const categories = Array.isArray(props.categories) ? props.categories : []
      if (categories.length === 0) return null
      return h(
        'div',
        { style: styles.legend },
        categories.map((row) =>
          h(
            'div',
            { key: row.key, style: styles.legendItem, 'data-ctx-legend': row.key, title: `${row.label} · ${formatTokens(row.tokens)} ${props.tokensLabel || ''}` },
            h('i', { style: { ...styles.dot, background: row.color } }),
            h('span', { style: styles.legendName }, row.label),
            h('span', { style: styles.legendValue }, `${compactTokens(row.tokens)} · ${formatPercent(row.share)}`),
          ),
        ),
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

    // ── 卡片折叠状态（记忆到 localStorage，按卡片 id 存） ──────────────────
    const COLLAPSED_STORAGE_KEY = 'ctx-mon-and-con:collapsed:v1'

    function readCollapsedMap() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return {}
        const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function Card(props) {
      const cardId = typeof props.id === 'string' ? props.id : null
      const [collapsed, setCollapsed] = react.useState(() => Boolean(cardId && readCollapsedMap()[cardId]))
      const t = props.t
      const toggle = () => {
        const next = !collapsed
        setCollapsed(next)
        if (!cardId) return
        try {
          if (typeof window === 'undefined' || !window.localStorage) return
          const map = readCollapsedMap()
          map[cardId] = next
          window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(map))
        } catch {}
      }
      return h(
        'div',
        { style: { ...styles.card, ...(props.style || {}) }, 'data-ctx-card': cardId || undefined, 'data-ctx-collapsed': collapsed ? '1' : '0' },
        h(
          'div',
          { style: styles.cardHead },
          cardId && typeof t === 'function'
            ? h(
                'button',
                {
                  type: 'button',
                  style: styles.cardToggle,
                  title: collapsed ? t('expand') : t('collapse'),
                  'aria-label': collapsed ? t('expand') : t('collapse'),
                  'aria-expanded': !collapsed,
                  'data-ctx-card-toggle': cardId,
                  onClick: toggle,
                },
                h('span', { style: { display: 'inline-block', transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s ease' } }, '›'),
              )
            : null,
          h('h3', { style: styles.cardTitle }, props.title),
          props.sub !== undefined ? h('span', { style: styles.cardSub }, props.sub) : null,
          props.action !== undefined ? props.action : null,
        ),
        collapsed ? null : props.children,
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
      const [state, setState] = react.useState({ data: null, at: null, error: null })
      const reload = react.useCallback(() => {
        fetch(path, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((payload) => {
            if (payload && payload.ok) setState({ data: payload, at: new Date().toISOString(), error: null })
            else throw new Error('invalid payload')
          })
          .catch((error) => setState((previous) => ({ ...previous, error: String((error && error.message) || error) })))
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
    /** 从 dock 弹层跳到完整 ctx 页面（点侧栏同名入口）。 */
    function openCtxPanelPage() {
      try {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        const target = candidates.find((element) => {
          const label = (element.getAttribute('aria-label') || '').trim()
          const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
          return label === 'ctx' || text === 'ctx'
        })
        if (target) {
          target.click()
          return true
        }
      } catch {}
      return false
    }

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
      const warnAt = data && typeof data.warnAt === 'number' ? data.warnAt : 0.75
      const errorAt = data && typeof data.errorAt === 'number' ? data.errorAt : 0.9
      const percent = ratio === null ? null : Math.round(ratio * 100)
      const color = ratioColor(ratio, warnAt, errorAt)
      const state = ratioState(ratio, warnAt, errorAt)
      const categories = breakdownCategories(t, data && data.breakdown)
      const compacting = Boolean(data && data.compacting)
      const label = compacting ? `${t('ctxBrand')} ${t('compacting')}` : percent === null ? `${t('ctxBrand')} —` : `${t('ctxBrand')} ${percent}%`

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
            title: used !== null && budget !== null ? `${formatTokens(used)} / ${formatTokens(budget)} ${t('tokens')}${state === 'error' ? ` · ${t('statusError')}` : state === 'warn' ? ` · ${t('statusWarn')}` : ''}` : t('meterAria'),
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
              h(SegmentedBar, { usedRatio: ratio ?? 0, categories, warnAt, errorAt }),
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
                h('p', { style: { margin: '6px 0 0', fontSize: '11px', opacity: 0.7 } }, t('compositionHint')),
                h(
                  'div',
                  { style: { marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--dsw-alias-border-l1)', display: 'flex', justifyContent: 'flex-end' } },
                  h(
                    'button',
                    { type: 'button', style: styles.copyBtn, 'data-ctx-open-panel': '1', onClick: () => { setOpen(false); openCtxPanelPage() } },
                    t('openPanel'),
                  ),
                ),
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
      const warnAt = live && typeof live.warnAt === 'number' ? live.warnAt : typeof budget.warnAt === 'number' ? budget.warnAt : 0.75
      const errorAt = live && typeof live.errorAt === 'number' ? live.errorAt : typeof budget.errorAt === 'number' ? budget.errorAt : 0.9
      const triggerAt = live && typeof live.triggerAt === 'number' ? live.triggerAt : typeof budget.triggerAt === 'number' ? budget.triggerAt : 1
      const targetAt = live && typeof live.targetAt === 'number' ? live.targetAt : typeof budget.targetAt === 'number' ? budget.targetAt : 0.6
      const color = ratioColor(ratio, warnAt, errorAt)
      const state = ratioState(ratio, warnAt, errorAt)
      const remaining = used !== null && budgetTokens > 0 ? Math.max(0, budgetTokens - used) : null
      const breakdown = (live && live.breakdown) || (liveUsed === null && latest ? latest.breakdown : null)
      const categories = breakdownCategories(t, breakdown)
      const sub = live ? `${t('synced')} ${formatTime(props.liveAt)}` : latest ? formatTime(latest.at) : undefined
      // 增量：同会话内这次刷新相对上次刷新的变化（切换会话时重新计）。
      const previousRef = react.useRef({ sessionId: null, used: null })
      const sessionKey = live && live.sessionId ? live.sessionId : latest && latest.id ? latest.id : null
      const delta = used !== null && previousRef.current.used !== null && previousRef.current.sessionId === sessionKey ? used - previousRef.current.used : null
      react.useEffect(() => {
        if (used === null) return
        previousRef.current = { sessionId: sessionKey, used }
      }, [sessionKey, used])
      const exact = (value) => (typeof value === 'number' ? `${formatTokens(value)} ${t('tokens')}` : '—')
      return h(
        Card,
        { title: t('budget'), sub, action: h(StatusBadge, { t, state }), id: 'overview', t },
        h(
          'div',
          { style: styles.heroBody },
          h(BigRing, { percent: ratio === null ? 0 : ratio * 100, color, label: t('ratio'), title: used === null ? '—' : `${formatTokens(used)} / ${formatTokens(budgetTokens)} ${t('tokens')}` }),
          h(
            'div',
            { style: styles.kpiGrid },
            h('div', { style: styles.kpi, title: exact(used) }, h('span', { style: styles.kpiLabel }, t('used')), h('span', { style: styles.kpiValue }, compactTokens(used)), h('span', { style: styles.kpiSub }, `${t('tokens')} · ${formatPercent(ratio, 0)}`)),
            h('div', { style: styles.kpi, title: exact(budgetTokens) }, h('span', { style: styles.kpiLabel }, t('budget')), h('span', { style: styles.kpiValue }, compactTokens(budgetTokens)), h('span', { style: styles.kpiSub }, t('tokens'))),
            h('div', { style: styles.kpi, title: exact(remaining) }, h('span', { style: styles.kpiLabel }, t('remaining')), h('span', { style: styles.kpiValue }, compactTokens(remaining)), h('span', { style: styles.kpiSub }, t('tokens'))),
            h(
              'div',
              { style: styles.kpi, title: delta === null ? '—' : exact(delta) },
              h('span', { style: styles.kpiLabel }, t('lastDelta')),
              h(
                'span',
                {
                  style: {
                    ...styles.kpiValue,
                    color: delta === null ? 'var(--dsw-alias-label-tertiary)' : delta > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)',
                  },
                },
                delta === null ? '—' : `${delta > 0 ? '+' : ''}${compactTokens(delta)}`,
              ),
              h('span', { style: styles.kpiSub }, t('tokens')),
            ),
          ),
        ),
        h(SegmentedBar, { usedRatio: ratio ?? 0, categories, warnAt, errorAt }),
        h(LegendGrid, { categories, tokensLabel: t('tokens') }),
        h(
          'div',
          { style: styles.thresholds },
          h('span', { style: { ...styles.thresholdChip, color: 'var(--dsw-alias-state-warn-primary)' } }, `${t('warnAt')} ${formatPercent(warnAt, 0)}`),
          h('span', { style: { ...styles.thresholdChip, color: 'var(--dsw-alias-state-error-primary)' } }, `${t('errorAt')} ${formatPercent(errorAt, 0)}`),
          h('span', { style: { ...styles.thresholdChip, color: triggerAt < 1 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)' } }, `${t('triggerAt')} ${formatPercent(triggerAt, 0)}`),
          h('span', { style: { ...styles.thresholdChip, color: 'var(--dsw-alias-label-tertiary)' } }, `${t('targetAt')} ${formatPercent(targetAt, 0)}`),
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
      const [onlyEnabled, setOnlyEnabled] = react.useState(false)
      const autoOpenRef = react.useRef(false)
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

      const enabledToolName = (name) => !disabledSessionTools.includes(name) && !disabledGlobalTools.includes(name)
      const enabledPromptName = (name) => !disabledSessionPrompts.includes(name)
      const enabledTools = tools.filter((tool) => enabledToolName(tool.name))
      const enabledSections = sections.filter((section) => enabledPromptName(section.name))
      const visibleTools = onlyEnabled ? enabledTools : tools
      const visibleSections = onlyEnabled ? enabledSections : sections

      // 内容少时默认展开，内容多时默认折叠；用户手动点过之后不再自动改变。
      react.useEffect(() => {
        if (autoOpenRef.current || !inventory) return
        autoOpenRef.current = true
        setOpen({ tools: tools.length > 0 && tools.length <= 6, prompts: sections.length > 0 && sections.length <= 6 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [inventory])

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

      const loading = Boolean(props.loading) && !inventory
      const loadError = props.error ? String(props.error) : null
      const empty = !loading && !loadError && tools.length === 0 && sections.length === 0
      const refreshButton = h('button', { type: 'button', style: styles.button, onClick: props.reload }, t('refresh'))
      if (loading) {
        return h(
          Card,
          { title: t('inventoryTitle'), id: 'inventory', t },
          h(
            'div',
            { style: styles.skeletonStack, 'data-ctx-inventory-loading': '1' },
            h('div', { style: { ...styles.skeleton, width: '46%' } }),
            h('div', { style: { ...styles.skeleton, width: '72%' } }),
            h('div', { style: { ...styles.skeleton, width: '58%' } }),
          ),
        )
      }
      if (loadError) {
        return h(
          Card,
          { title: t('inventoryTitle'), id: 'inventory', t },
          h(
            'div',
            { style: styles.emptyState, 'data-ctx-inventory-error': '1' },
            h('p', { style: styles.error }, `${t('inventoryLoadFailed')}: ${loadError}`),
            refreshButton,
          ),
        )
      }
      return h(
        Card,
        { title: t('inventoryTitle'), sub: data.sessionId ? shortSessionId(data.sessionId) : undefined, id: 'inventory', t },
        empty
          ? h(
              'div',
              { style: styles.emptyState, 'data-ctx-inventory-empty': '1' },
              h('p', { style: styles.emptyText }, t('inventoryEmpty')),
              refreshButton,
            )
          : null,
        !empty
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              h(
                'div',
                { style: styles.filterRow },
                h('span', { style: styles.filterCount }, `${t('inventoryTools')} ${enabledTools.length}/${tools.length}`),
                h('span', { style: styles.filterCount }, `${t('inventoryPrompts')} ${enabledSections.length}/${sections.length}`),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...styles.filterToggle, ...(onlyEnabled ? styles.filterToggleOn : null) },
                    'data-ctx-only-enabled': String(onlyEnabled),
                    'aria-pressed': onlyEnabled,
                    onClick: () => setOnlyEnabled(!onlyEnabled),
                  },
                  onlyEnabled ? '✓ ' : '',
                  t('onlyEnabled'),
                ),
              ),
              h(
                'div',
                { style: styles.inventorySection },
                h(
                  'button',
                  { type: 'button', style: styles.sectionHead, 'data-ctx-section': 'tools', onClick: () => setOpen({ ...open, tools: !open.tools }) },
                  chevron(open.tools), t('inventoryTools'), h('span', { style: styles.cardSub }, onlyEnabled ? `${visibleTools.length}/${tools.length}` : String(tools.length)),
                ),
                open.tools ? (visibleTools.length === 0 ? h('p', { style: styles.emptyText }, t('noneEnabled')) : h('ul', { style: styles.inventoryList }, visibleTools.map(toolRow))) : null,
              ),
              h(
                'div',
                { style: styles.inventorySection },
                h(
                  'button',
                  { type: 'button', style: styles.sectionHead, 'data-ctx-section': 'prompts', onClick: () => setOpen({ ...open, prompts: !open.prompts }) },
                  chevron(open.prompts), t('inventoryPrompts'), h('span', { style: styles.cardSub }, onlyEnabled ? `${visibleSections.length}/${sections.length}` : String(sections.length)),
                ),
                open.prompts ? (visibleSections.length === 0 ? h('p', { style: styles.emptyText }, t('noneEnabled')) : h('ul', { style: styles.inventoryList }, visibleSections.map(promptRow))) : null,
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
      )
    }

    function ControlSection(props) {
      const t = props.t
      const control = props.control || {}
      const logs = Array.isArray(control.log) ? control.log : []
      const [state, setState] = react.useState({ kind: 'idle' })
      const [logOpen, setLogOpen] = react.useState(false)

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
          style: styles.cardFill,
          id: 'control',
          t,
          action: control.active
            ? control.compacting
              ? h(StatusBadge, { t, state: 'warn', label: t('compacting') })
              : h(StatusBadge, { t, state: 'ok' })
            : h('span', { style: { ...styles.badge, color: 'var(--dsw-alias-label-tertiary)', borderColor: 'var(--dsw-alias-border-l2)' } }, t('controlOff')),
        },
        h('p', { style: styles.text }, control.active ? (control.compacting ? t('compactingHint') : t('controlReady')) : t('controlMissing')),
        control.active && control.lastCompaction
          ? h(
              'div',
              { style: styles.kpi },
              h('span', { style: styles.kpiLabel }, t('controlLast')),
              h('span', { style: styles.kpiValue }, `${compactTokens(control.lastCompaction.before)} → ${compactTokens(control.lastCompaction.after)}`),
              h('span', { style: styles.kpiSub }, `${t('tokens')} · ${formatTime(control.lastCompactionAt)}`),
            )
          : null,
        control.lastError
          ? h('p', { style: styles.error, 'data-ctx-lasterror': '1' }, `${t('controlError')}: ${control.lastError}`)
          : null,
        control.presetMountable ? h('p', { style: { ...styles.text, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11.5px' } }, t('controlPresetHint')) : null,
        h(
          'div',
          { style: styles.actionRow },
          control.presetMountable
            ? h(
                'button',
                { type: 'button', style: { ...styles.button, ...(control.active ? null : styles.buttonPrimary) }, disabled: state.kind === 'saving', onClick: () => toggle(!control.active) },
                state.kind === 'saving' ? t('controlBusy') : control.active ? t('controlDisable') : t('controlEnable'),
              )
            : null,
          state.kind === 'error' ? h('p', { style: styles.error }, state.message) : null,
          state.kind === 'notice' ? h('p', { style: styles.successText }, state.message) : null,
        ),
        h(
          'div',
          { style: styles.logBox, 'data-ctx-compact-log': '1' },
          h(
            'button',
            {
              type: 'button',
              style: styles.logToggle,
              'aria-expanded': logOpen,
              'data-ctx-log-toggle': '1',
              onClick: () => setLogOpen(!logOpen),
            },
            h('span', { style: { display: 'inline-block', transform: logOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' } }, '›'),
            h('span', null, t('compactLog')),
            h('span', { style: styles.cardSub }, String(logs.length)),
          ),
          logOpen
            ? logs.length === 0
              ? h('p', { style: styles.emptyText, 'data-ctx-log-empty': '1' }, t('compactNoLogs'))
              : h(
                  'ul',
                  { style: styles.logList, 'data-ctx-log-list': '1' },
                  logs
                    .slice()
                    .reverse()
                    .map((entry) => {
                      const ok = entry && entry.outcome === 'success'
                      const statusStyle = ok ? styles.badgeOk : styles.badgeError
                      const meta = []
                      if (entry.rounds) meta.push(`${entry.rounds} ${t('roundsUnit')}`)
                      if (entry.trigger) meta.push(entry.trigger)
                      return h(
                        'li',
                        { key: entry.id || `${entry.at}-${entry.outcome}`, style: styles.logItem, 'data-ctx-log-item': entry.id || undefined, 'data-ctx-log-outcome': ok ? 'success' : 'failure' },
                        h(
                          'div',
                          { style: styles.logLine },
                          h('span', { style: { ...styles.badge, ...statusStyle } }, ok ? t('compactSuccess') : t('compactFailure')),
                          h('span', { style: styles.logTime }, formatTime(entry.at)),
                          h(
                            'span',
                            {
                              style: styles.logMain,
                              title: entry.before !== null && entry.after !== null ? `${formatTokens(entry.before)} → ${formatTokens(entry.after)} ${t('tokens')}` : undefined,
                            },
                            `${compactTokens(entry.before)} → ${compactTokens(entry.after)} ${t('tokens')}${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`,
                          ),
                          entry.sessionId ? h('span', { style: styles.logSession, title: entry.sessionId }, shortSessionId(entry.sessionId)) : null,
                        ),
                        entry.message ? h('p', { style: styles.logMessage, 'data-ctx-log-message': '1' }, entry.message) : null,
                      )
                    }),
                )
            : null,
        ),
      )
    }

    function ConfigSection(props) {
      const t = props.t
      const budget = props.budget || {}
      const editable = Boolean(props.editable)
      const [draft, setDraft] = react.useState({ tokens: '', warn: '', error: '', trigger: '', target: '' })
      const [result, setResult] = react.useState({ kind: 'idle' })

      react.useEffect(() => {
        setDraft({
          tokens: budget.tokens === undefined ? '' : String(budget.tokens),
          warn: budget.warnAt === undefined ? '' : String(budget.warnAt),
          error: budget.errorAt === undefined ? '' : String(budget.errorAt),
          trigger: budget.triggerAt === undefined ? '' : String(budget.triggerAt),
          target: budget.targetAt === undefined ? '' : String(budget.targetAt),
        })
      }, [budget.tokens, budget.warnAt, budget.errorAt, budget.triggerAt, budget.targetAt])

      const save = () => {
        const tokens = Number(draft.tokens)
        const warn = Number(draft.warn)
        const error = Number(draft.error)
        const trigger = Number(draft.trigger)
        const target = Number(draft.target)
        if (!Number.isInteger(tokens) || tokens <= 0) {
          setResult({ kind: 'error', message: t('invalidTokens') })
          return
        }
        if (!(warn > 0 && warn <= 1) || !(error > 0 && error <= 1) || warn >= error) {
          setResult({ kind: 'error', message: t('invalidRatios') })
          return
        }
        if (!(trigger > 0 && trigger <= 1)) {
          setResult({ kind: 'error', message: t('invalidTrigger') })
          return
        }
        if (!(target > 0 && target < 1) || !(target < trigger)) {
          setResult({ kind: 'error', message: t('invalidTarget') })
          return
        }
        setResult({ kind: 'saving' })
        fetch(`${STATUS_PATH}/config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contextWindowTokens: tokens, warnAt: warn, errorAt: error, triggerAt: trigger, targetAt: target }),
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
      const source = typeof budget.source === 'string' && budget.source !== '' ? budget.source : null
      return h(
        Card,
        { title: t('configTitle'), style: styles.cardFill, sub: editable ? undefined : t('configUnavailable'), id: 'config', t },
        editable
          ? h(
              'div',
              { style: styles.configGrid },
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('defaultBudgetShort')),
                  h('span', { style: styles.fieldUnit }, t('tokens')),
                ),
                h('input', { style: styles.input, type: 'number', min: 1, step: 1000, value: draft.tokens, disabled, onChange: (event) => setDraft({ ...draft, tokens: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('warnLabel')),
                  h('span', { style: styles.fieldUnit }, '0–1'),
                ),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 1, step: 0.01, value: draft.warn, disabled, onChange: (event) => setDraft({ ...draft, warn: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('errorLabel')),
                  h('span', { style: styles.fieldUnit }, '0–1'),
                ),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 1, step: 0.01, value: draft.error, disabled, onChange: (event) => setDraft({ ...draft, error: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('triggerLabel')),
                  h('span', { style: styles.fieldUnit }, '0–1'),
                ),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 1, step: 0.01, value: draft.trigger, disabled, onChange: (event) => setDraft({ ...draft, trigger: event.target.value }) }),
              ),
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('targetLabel')),
                  h('span', { style: styles.fieldUnit }, '0–1'),
                ),
                h('input', { style: styles.input, type: 'number', min: 0.01, max: 0.99, step: 0.01, value: draft.target, disabled, onChange: (event) => setDraft({ ...draft, target: event.target.value }) }),
              ),
            )
          : null,
        source ? h('p', { style: { ...styles.cardSub, marginLeft: 0 } }, `${t('source')}: ${source}`) : null,
        h('p', { style: styles.text }, t('configHint')),
        h('p', { style: { ...styles.text, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11.5px' } }, t('triggerHint')),
        h(
          'div',
          { style: styles.actionRow },
          editable
            ? h('button', { type: 'button', style: { ...styles.button, ...styles.buttonPrimary }, onClick: save, disabled }, result.kind === 'saving' ? t('saving') : t('save'))
            : null,
          result.kind === 'saved' ? h('p', { style: styles.successText, 'data-ctx-config-saved': '1' }, t('saved')) : null,
          result.kind === 'error' ? h('p', { style: styles.error }, result.message) : null,
        ),
      )
    }

    /** 共享面板：设置分区与整页都用它。 */
    // ── 会话洞察：KPI / 每日图 / 会话卡 / 趋势 / 事件 ───────────────────────
    function KpiBand(props) {
      const t = props.t
      const kpi = props.kpi || {}
      const cost = typeof kpi.cost === 'number' ? `¥${kpi.cost >= 0.01 ? kpi.cost.toFixed(2) : kpi.cost.toFixed(4)}` : '—'
      const items = [
        { key: 'sessions', label: t('kpiSessions'), value: formatTokens(kpi.sessions), sub: props.coverage ? t('coverageShort').replace('{scanned}', props.coverage.scanned).replace('{total}', props.coverage.total) : '' },
        { key: 'tokens', label: t('kpiTokens'), value: compactTokens(kpi.tokens), sub: `≈ ${formatTokens(kpi.tokens)} tok` },
        { key: 'cache', label: t('kpiCache'), value: formatPercent(kpi.cacheHit, 1), sub: `${compactTokens(kpi.cacheRead || 0)} cache` },
        { key: 'cost', label: t('kpiCost'), value: cost, sub: kpi.cost === null || kpi.cost === undefined ? t('costUnknown') : t('costEstimated') },
        { key: 'tools', label: t('kpiTools'), value: formatTokens(kpi.toolCalls), sub: '' },
        { key: 'active', label: t('kpiActive'), value: formatDurationMs(kpi.activeMs), sub: '' },
        { key: 'compactions', label: t('kpiCompactions'), value: formatTokens(kpi.compactions), sub: kpi.injections ? `${formatTokens(kpi.injections)} inject` : '' },
      ]
      return h('div', { style: styles.kpiBand, 'data-ctx-kpis': '1' }, items.map((item) => h('div', { key: item.key, style: styles.kpiCard, 'data-ctx-kpi': item.key },
        h('span', { style: styles.kpiCardLabel }, item.label),
        h('strong', { style: styles.kpiCardValue }, item.value),
        item.sub ? h('span', { style: styles.kpiCardSub }, item.sub) : null,
      )))
    }

    function DailyChart(props) {
      const t = props.t
      const daily = Array.isArray(props.daily) ? props.daily : []
      const max = Math.max(1, ...daily.map((day) => Number(day.tokens) || 0))
      return h('div', { style: styles.chartWrap, 'data-ctx-daily': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('dailyTitle')), h('span', { style: styles.cardSub }, `${compactTokens(daily.reduce((sum, day) => sum + (Number(day.tokens) || 0), 0))} tok`)),
        h('div', { style: styles.chartBars }, daily.map((day) => {
          const value = Number(day.tokens) || 0
          const ratio = value / max
          return h('div', { key: day.date, style: styles.chartBarCol, title: `${day.date} · ${formatTokens(value)} tok · ${day.requests} req` },
            h('div', { style: { ...styles.chartBar, ...(value === 0 ? styles.chartBarZero : null), height: `${Math.max(2, ratio * 100)}%` } }),
            h('span', { style: styles.chartLabel }, String(day.date).slice(5)),
          )
        })),
      )
    }

    function Heatmap(props) {
      const t = props.t
      const daily = Array.isArray(props.daily) ? props.daily : []
      const max = Math.max(1, ...daily.map((day) => Number(day.tokens) || 0))
      return h('div', { style: styles.chartWrap, 'data-ctx-heatmap': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('heatmapTitle')), h('span', { style: styles.cardSub }, `${daily.length}d`)),
        h('div', { style: styles.heatGrid }, daily.map((day) => {
          const ratio = (Number(day.tokens) || 0) / max
          return h('div', { key: day.date, style: { ...styles.heatCell, opacity: ratio === 0 ? 1 : 0.2 + ratio * 0.8, background: ratio === 0 ? undefined : 'var(--dsw-alias-brand-primary)' }, title: `${day.date} · ${formatTokens(day.tokens)} tok · ${day.requests} req` })
        })),
      )
    }

    function SessionCards(props) {
      const t = props.t
      const sessions = Array.isArray(props.sessions) ? props.sessions : []
      const [query, setQuery] = react.useState('')
      const [sort, setSort] = react.useState('recent')
      const [expanded, setExpanded] = react.useState(false)
      const needle = query.trim().toLowerCase()
      const filtered = sessions
        .filter((item) => {
          if (!needle) return true
          return [item.title, item.cwd, item.id, item.model].some((value) => String(value || '').toLowerCase().includes(needle))
        })
        .slice()
        .sort((a, b) => (sort === 'tokens' ? (b.tokens || 0) - (a.tokens || 0) : (b.lastActivityAt || 0) - (a.lastActivityAt || 0)))
      const visible = expanded ? filtered : filtered.slice(0, 12)
      const base = (item) => (String(item || '').split(/[\\/]/).filter(Boolean).pop() || '—')
      return h('div', { style: styles.card, 'data-ctx-sessions': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('sessionsTitle')), h('span', { style: styles.cardSub }, `${filtered.length}/${sessions.length}`)),
        h('div', { style: styles.filterBar },
          h('input', { style: styles.searchInput, value: query, placeholder: t('searchSessions'), onChange: (event) => setQuery(event.target.value), 'data-ctx-session-search': '1' }),
          h('button', { type: 'button', style: { ...styles.filterToggle, ...(sort === 'recent' ? styles.filterToggleOn : null) }, onClick: () => setSort('recent') }, t('sortRecent')),
          h('button', { type: 'button', style: { ...styles.filterToggle, ...(sort === 'tokens' ? styles.filterToggleOn : null) }, onClick: () => setSort('tokens') }, t('sortTokens')),
        ),
        filtered.length === 0 ? h('p', { style: styles.emptyText }, t('noSessions')) : h('div', { style: styles.sessionList }, visible.map((item) =>
          h('button', { key: item.id, type: 'button', style: { ...styles.sessionCard, ...(props.selected === item.id ? styles.sessionCardOn : null) }, onClick: () => props.onSelect(item.id), title: item.id, 'data-ctx-session-card': item.id },
            h('p', { style: styles.sessionTitle }, item.title || shortSessionId(item.id)),
            h('span', { style: styles.sessionMeta }, `${base(item.cwd)} · ${item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : '—'}`),
            h('div', { style: styles.sessionStats },
              h('span', null, `${compactTokens(item.tokens)} tok`),
              h('span', null, `${formatTokens(item.turns)} ${t('turnsLabel')}`),
              h('span', null, `${formatTokens(item.requests)} ${t('requestsLabel')}`),
              item.compactions > 0 ? h('span', null, `${formatTokens(item.compactions)}×` ) : null,
            ),
          ),
        )),
        filtered.length > 12 ? h('button', { type: 'button', style: styles.button, onClick: () => setExpanded((value) => !value), 'data-ctx-session-more': '1' }, expanded ? t('showLess') : t('showMore')) : null,
      )
    }

    function TrendCard(props) {
      const t = props.t
      const detail = props.detail
      if (!detail) {
        return h('div', { style: styles.card }, h('h3', { style: styles.cardTitle }, t('trendTitle')), props.error ? h('p', { style: styles.error }, `${t('analyticsError')}: ${props.error}`) : h('div', { style: styles.skeletonStack }, h('div', { style: { ...styles.skeleton, width: '100%', height: '120px' } })))
      }
      const requests = Array.isArray(detail.requests) ? detail.requests.slice(-40) : []
      const compactions = Array.isArray(detail.compactions) ? detail.compactions : []
      if (requests.length === 0) return h('div', { style: styles.card }, h('h3', { style: styles.cardTitle }, t('trendTitle')), h('p', { style: styles.emptyText }, t('trendNoData')))
      const max = Math.max(1, ...requests.map((item) => (Number(item.prompt) || 0) + (Number(item.output) || 0)))
      return h('div', { style: { ...styles.card, ...styles.cardFill }, 'data-ctx-trend': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('trendTitle')), h('span', { style: styles.cardSub }, `${requests.length} req`)),
        h('div', { style: styles.legendInline },
          h('span', null, `■ ${t('trendPrompt')}`), h('span', null, `■ ${t('trendOutput')}`), h('span', null, `━ ${t('trendCompaction')}`), h('span', null, `${t('budgetLine')} ${formatTokens(props.budget)}`),
        ),
        h('div', { style: styles.trendScroll }, h('div', { style: styles.trendCols }, requests.map((item, index) => {
          const previous = index > 0 ? requests[index - 1].time : 0
          const marker = compactions.some((compaction) => compaction.at <= item.time && compaction.at > previous)
          const promptHeight = Math.max(2, Math.round(((Number(item.prompt) || 0) / max) * 118))
          const outputHeight = Math.max(1, Math.round(((Number(item.output) || 0) / max) * 118))
          return h('div', { key: `${item.time}-${index}`, style: styles.trendCol, title: `#${index + 1} · ${formatTokens(item.prompt)} prompt + ${formatTokens(item.output)} output${item.compaction ? ' · after compaction' : ''}` },
            marker ? h('div', { style: styles.trendMarker }) : null,
            h('div', { style: { ...styles.trendOutput, height: `${outputHeight}px` } }),
            h('div', { style: { ...styles.trendPrompt, height: `${promptHeight}px` } }),
            h('span', { style: styles.chartLabel }, item.turn !== null ? `T${item.turn}` : ''),
          )
        }))),
        h('div', { style: styles.banner, 'data-ctx-detail-session': detail.session ? detail.session.id : '' }, `${detail.session && detail.session.title ? detail.session.title : '—'} · ${t('requestsLabel')} ${detail.requests.length} · ${detail.session && detail.session.lastActivityAt ? new Date(detail.session.lastActivityAt).toLocaleString() : '—'}`),
        compactions.length > 0 ? h('div', { style: styles.logBox }, h('div', { style: styles.logToggle }, `${t('eventCompaction')} · ${compactions.length}`), h('ul', { style: styles.logList }, compactions.slice(-8).reverse().map((item) =>
          h('li', { key: `${item.at}-${item.turn}`, style: styles.logItem },
            h('div', { style: styles.logLine },
              h('span', { style: styles.logTime }, item.at ? new Date(item.at).toLocaleTimeString() : '—'),
              h('span', { style: styles.logMain }, `${formatTokens(item.shadowedTokens)} tok`),
              h('span', { style: styles.logSession }, `${t('durationLabel')} ${formatDurationMs(item.durationMs)}`),
            ),
          ),
        ))) : null,
      )
    }

    function EventsCard(props) {
      const t = props.t
      const [filter, setFilter] = react.useState('all')
      const logs = Array.isArray(props.logs) ? props.logs.slice().reverse() : []
      const filtered = logs.filter((entry) => filter === 'all' || entry.outcome === filter)
      const rawTimeline = props.detail && Array.isArray(props.detail.timeline) ? props.detail.timeline.slice().reverse() : []
      const timeline = rawTimeline.filter((item) => item.kind === 'compaction').slice(0, 30)
      const injectionCount = rawTimeline.filter((item) => item.kind === 'inject').length
      return h('div', { style: styles.card, 'data-ctx-events': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('eventsTitle')), h('span', { style: styles.cardSub }, `${filtered.length}/${logs.length}${injectionCount > 0 ? ` · ${injectionCount} ${t('eventInject')}` : ''}`)),
        h('div', { style: styles.filterBar },
          [['all', t('eventAll')], ['success', t('eventSuccess')], ['failure', t('eventFailure')]].map(([key, label]) =>
            h('button', { key, type: 'button', style: { ...styles.filterToggle, ...(filter === key ? styles.filterToggleOn : null) }, onClick: () => setFilter(key) }, label),
          ),
        ),
        filtered.length === 0 ? h('p', { style: styles.emptyText }, t('noEvents')) : h('ul', { style: styles.eventList }, filtered.map((entry) => {
          const success = entry.outcome === 'success'
          return h('li', { key: entry.id, style: styles.eventItem, 'data-ctx-event': entry.outcome },
            h('span', { style: { ...styles.eventKind, color: success ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, success ? t('eventSuccess') : t('eventFailure')),
            h('div', { style: styles.eventMain },
              h('div', null, entry.before || entry.after ? `${t('beforeAfter')}: ${formatTokens(entry.before)} → ${formatTokens(entry.after)}${entry.target ? ` · ${t('targetLine')} ${formatTokens(entry.target)}` : ''}` : `${t('targetLine')} ${formatTokens(entry.target)}`),
              h('div', { style: styles.sessionMeta }, `${entry.trigger || '—'}${entry.rounds !== null && entry.rounds !== undefined ? ` · ${t('roundsLabel')} ${entry.rounds}` : ''}${entry.durationMs !== null && entry.durationMs !== undefined ? ` · ${t('durationLabel')} ${formatDurationMs(entry.durationMs)}` : ''}${entry.shadowed ? ` · ${formatTokens(entry.shadowed)} tok` : ''}`),
              entry.message ? h('div', { style: styles.logMessage }, entry.message) : null,
            ),
            h('span', { style: styles.eventAside }, formatTime(entry.at)),
          )
        })),
        timeline.length > 0 ? h('div', { style: styles.logBox },
          h('div', { style: styles.logToggle }, `${t('eventCompaction')} · ${timeline.length}`),
          h('ul', { style: styles.eventList }, timeline.map((item, index) =>
            h('li', { key: `${item.time}-${index}`, style: styles.eventItem },
              h('span', { style: styles.eventKind }, item.kind === 'compaction' ? t('eventCompaction') : t('eventInject')),
              h('span', { style: styles.eventMain }, item.detail || ''),
              h('span', { style: styles.eventAside }, item.time ? new Date(item.time).toLocaleTimeString() : '—'),
            ),
          )),
        ) : null,
      )
    }

    function CtxPanel(props) {
      const t = props.t
      const [state, load] = useStatus(STATUS_PATH)
      const [tab, setTab] = react.useState('overview')
      const [range, setRange] = react.useState('7d')
      const [selected, setSelected] = react.useState(null)
      const activeSession = useCurrentSession()
      const usageTick = useUsageActivity()
      const livePath = activeSession ? `${STATUS_PATH}/live?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/live`
      const inventoryPath = activeSession ? `${STATUS_PATH}/inventory?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/inventory`
      const analyticsPath = `${STATUS_PATH}/analytics?range=${encodeURIComponent(range)}&limit=40`
      const detailSession = selected || activeSession
      const detailPath = detailSession ? `${STATUS_PATH}/session-detail?sessionId=${encodeURIComponent(detailSession)}` : `${STATUS_PATH}/session-detail`
      const [liveState, reloadLive] = useLive(livePath, usageTick)
      const [invState, reloadInv] = useLive(inventoryPath, usageTick)
      const [analyticsState, reloadAnalytics] = useLive(analyticsPath)
      const [detailState, reloadDetail] = useLive(detailPath)
      const live = liveState.data
      const data = state.phase === 'ready' ? state.data || {} : null
      const budget = data ? data.budget || {} : {}
      const control = data ? data.control || {} : {}
      const measurements = data && Array.isArray(data.measurements) ? data.measurements : []
      const latest = measurements.length > 0 ? measurements[0] : null
      const analytics = analyticsState.data || null
      const detail = detailState.data || null
      const reloadAll = () => { load(); reloadLive(); reloadInv(); reloadAnalytics(); reloadDetail() }

      const tabs = [
        ['overview', t('tabsOverview')],
        ['trend', t('tabsTrend')],
        ['events', t('tabsEvents')],
        ['settings', t('tabsSettings')],
      ]

      const children = [
        h('div', { key: 'header', style: styles.headerCard },
          h('div', { style: styles.headerRow },
            h('h2', { style: styles.title }, props.title || t('title')),
            data && data.version ? h('span', { style: styles.versionChip, title: `${t('versionLabel')}: ${data.version}`, 'data-ctx-version': String(data.version) }, `v${data.version}`) : null,
            h('span', { style: styles.headerSpacer }),
            control.active ? h(StatusBadge, { t, state: control.compacting ? 'warn' : 'ok', label: control.compacting ? t('compacting') : undefined }) : null,
            h('button', { type: 'button', style: styles.button, onClick: reloadAll, 'data-ctx-refresh': '1' }, t('refresh')),
          ),
          h('p', { style: styles.subtitle }, t('description')),
          h('div', { style: styles.tabs, role: 'tablist' }, tabs.map(([key, label]) =>
            h('button', { key, type: 'button', role: 'tab', 'aria-selected': tab === key ? 'true' : 'false', style: { ...styles.tab, ...(tab === key ? styles.tabActive : null) }, onClick: () => setTab(key), 'data-ctx-tab': key }, label),
          )),
          tab === 'overview' ? h('div', { style: styles.rangeRow },
            [['7d', t('range7')], ['30d', t('range30')], ['all', t('rangeAll')]].map(([key, label]) =>
              h('button', { key, type: 'button', style: { ...styles.rangeBtn, ...(range === key ? styles.rangeBtnOn : null) }, onClick: () => setRange(key), 'data-ctx-range': key }, label),
            ),
          ) : null,
        ),
      ]

      if (state.phase === 'loading') {
        children.push(h('div', { key: 'loading', style: styles.card }, h('div', { style: styles.skeletonStack },
          h('div', { style: { ...styles.skeleton, width: '38%', height: '14px' } }),
          h('div', { style: { ...styles.skeleton, width: '100%', height: '84px' } }),
          h('div', { style: { ...styles.skeleton, width: '64%' } }),
        )))
        return h('div', { style: styles.root, 'data-ctx-panel': '1' }, children)
      }
      if (state.phase === 'error') {
        children.push(h('div', { key: 'error', style: styles.emptyState },
          h('p', { style: styles.error }, `${t('error')}: ${state.message}`),
          h('button', { type: 'button', style: styles.button, onClick: reloadAll }, t('retry')),
        ))
        return h('div', { style: styles.root, 'data-ctx-panel': '1' }, children)
      }

      if (tab === 'overview') {
        children.push(h(KpiBand, { key: 'kpis', t, kpi: analytics ? analytics.kpi : {}, coverage: analytics ? analytics.coverage : null }))
        if (analyticsState.error && !analytics) {
          children.push(h('div', { key: 'analyticsError', style: styles.emptyState },
            h('p', { style: styles.error }, `${t('analyticsError')}: ${analyticsState.error}`),
            h('button', { type: 'button', style: styles.button, onClick: reloadAnalytics }, t('retry')),
          ))
        } else if (!analytics) {
          children.push(h('div', { key: 'analyticsLoading', style: styles.banner }, t('analyticsLoading')))
        }
        if (analytics) {
          children.push(h('div', { key: 'charts', style: styles.cols },
            h('div', { style: { ...styles.card, ...styles.cardFill } }, h(DailyChart, { t, daily: analytics.daily })),
            h('div', { style: { ...styles.card, ...styles.cardFill } }, h(Heatmap, { t, daily: analytics.daily })),
          ))
        }
        children.push(h(OverviewCard, { key: 'overview', t, budget, latest, live, liveAt: liveState.at, controlActive: Boolean(control.active) }))
        children.push(h(SessionCards, { key: 'sessions', t, sessions: analytics ? analytics.sessions : [], selected: detailSession, onSelect: (id) => { setSelected(id); setTab('trend') } }))
        if (analytics && Array.isArray(analytics.warnings) && analytics.warnings.length > 0) {
          children.push(h('div', { key: 'warnings', style: styles.banner, title: analytics.warnings.join(' | ') }, `${t('coverage').replace('{scanned}', analytics.coverage.scanned).replace('{total}', analytics.coverage.total)} · ${t('readFailures').replace('{count}', String(analytics.warnings.length))}`))
        }
      } else if (tab === 'trend') {
        children.push(h(TrendCard, { key: 'trend', t, detail, error: detailState.error, budget: (live && live.budget && live.budget.tokens) || (latest && latest.budget && latest.budget.tokens) || budget.tokens }))
        if (selected) children.push(h('button', { key: 'back', type: 'button', style: styles.button, onClick: () => setSelected(null) }, t('tabsOverview')))
      } else if (tab === 'events') {
        children.push(h(EventsCard, { key: 'events', t, logs: control.log || [], detail }))
      } else {
        children.push(h('div', { key: 'settings', style: styles.cols },
          h(ControlSection, { t, control, onToggled: load }),
          h(ConfigSection, { t, budget, editable: Boolean(data.configEditable), onSaved: load }),
        ))
        children.push(h(InventoryCard, { key: 'inventory', t, data: invState.data, loading: invState.data === null && invState.error === null, error: invState.data === null ? invState.error : null, reload: reloadInv, sessionId: activeSession }))
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

      // prefers-reduced-motion：关闭本插件面板 / dock 的过渡与动画（不改宿主样式）。
      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.head) return () => {}
        const styleId = 'ctx-mon-and-con-reduced-motion'
        if (document.getElementById(styleId)) return () => {}
        const style = document.createElement('style')
        style.id = styleId
        style.textContent =
          '@media (prefers-reduced-motion: reduce){[data-ctx-panel],[data-ctx-panel] *,[data-ctx-dock],[data-ctx-dock] *{transition-duration:0.01ms !important;animation-duration:0.01ms !important;animation-iteration-count:1 !important;scroll-behavior:auto !important}}'
        document.head.appendChild(style)
        return () => {
          try {
            style.remove()
          } catch {}
        }
      }, 'ctx-mon-and-con: reduced motion')

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
