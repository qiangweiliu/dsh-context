    function CtxPanel(props) {
      const t = props.t
      const [state, load] = useStatus(STATUS_PATH)
      // data / budget 必须声明在 analyticsLimit 之前：analyticsLimit 读 budget.analyticsLimit，
      // 而 const 在函数作用域里是 TDZ，晚于使用点声明会抛 ReferenceError 让整块面板变空。
      const data = state.phase === 'ready' ? state.data || {} : null
      const budget = data ? data.budget || {} : {}
      const [tab, setTab] = react.useState('overview')
      const [range, setRange] = react.useState('7d')
      const [selected, setSelected] = react.useState(null)
      const activeSession = useCurrentSession()
      const usageTick = useUsageActivity()
      const livePath = activeSession ? `${STATUS_PATH}/live?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/live`
      const inventoryPath = activeSession ? `${STATUS_PATH}/inventory?sessionId=${encodeURIComponent(activeSession)}` : `${STATUS_PATH}/inventory`
      const analyticsLimit = Number(budget.analyticsLimit) > 0 ? Number(budget.analyticsLimit) : 40
      const analyticsPath = `${STATUS_PATH}/analytics?range=${encodeURIComponent(range)}&limit=${analyticsLimit}`
      const insightsPath = `${STATUS_PATH}/insights?range=${encodeURIComponent(range)}&limit=${analyticsLimit}`
      const detailSession = selected || activeSession
      const detailPath = detailSession ? `${STATUS_PATH}/session-detail?sessionId=${encodeURIComponent(detailSession)}` : `${STATUS_PATH}/session-detail`
      const [liveState, reloadLive] = useLive(livePath, usageTick, Boolean(activeSession))
      const [invState, reloadInv] = useLive(inventoryPath, usageTick, tab === 'settings')
      const [analyticsState, reloadAnalytics] = useLive(analyticsPath, activeSession, tab === 'overview' || tab === 'trend' || tab === 'settings')
      const [insightsState, reloadInsights] = useLive(insightsPath, activeSession, tab === 'overview')
      const [detailState, reloadDetail] = useLive(detailPath, detailSession || activeSession, tab === 'trend' || tab === 'events')
      const [alertsEnabled, setAlerts] = useAlertsEnabled()
      // 切换主视图会话时清掉手动选中的历史会话，避免详情停在旧会话而头部显示新会话。
      react.useEffect(() => {
        setSelected(null)
      }, [activeSession])
      const live = liveState.data
      const liveForHeader = live && (!activeSession || live.sessionId === activeSession) ? live : null
      const control = data ? data.control || {} : {}
      const measurements = data && Array.isArray(data.measurements) ? data.measurements : []
      const latest = measurements.length > 0 ? measurements[0] : null
      const analytics = analyticsState.data || null
      const detail = detailState.data || null
      const reloadAll = () => {
        load()
        reloadLive()
        if (tab === 'settings') reloadInv()
        if (tab === 'overview' || tab === 'trend' || tab === 'settings') reloadAnalytics()
        if (tab === 'overview') reloadInsights()
        if (tab === 'trend' || tab === 'events') reloadDetail()
      }

      const tabs = [
        ['overview', t('tabsOverview')],
        ['trend', t('tabsTrend')],
        ['events', t('tabsEvents')],
        ['settings', t('tabsSettings')],
      ]

      // tab 的 id、aria 关系与键盘交互都从这一份顺序推导，避免再手工维护第二份键列表。
      const tabKeys = tabs.map(([key]) => key)
      // 同一页面里面板可能同时挂在设置页和左侧整页：用 useId 让两个实例的 id 不互相覆盖。
      // 宿主 react 没有 useId（旧版本或测试桩）时退回固定前缀；调用点始终无条件，符合 hooks 规则。
      const useHostId = typeof react.useId === 'function' ? react.useId : () => 'embody'
      const idPrefix = String(useHostId()).replace(/:/g, '')
      const tabDomId = (key) => `${idPrefix}-tab-${key}`
      const panelDomId = (key) => `${idPrefix}-tabpanel-${key}`
      /**
       * ARIA tabs 的标准键盘交互：←/→ 在 tab 之间循环，Home/End 跳到首尾。
       * 切换仍然复用 setTab，和点击共用同一份状态；切完把焦点送到新 tab，方便连续按方向键。
       */
      const onTabKeyDown = (event) => {
        const index = tabKeys.indexOf(tab)
        if (index < 0 || !event || typeof event.key !== 'string') return
        let next = null
        if (event.key === 'ArrowRight') next = tabKeys[(index + 1) % tabKeys.length]
        else if (event.key === 'ArrowLeft') next = tabKeys[(index - 1 + tabKeys.length) % tabKeys.length]
        else if (event.key === 'Home') next = tabKeys[0]
        else if (event.key === 'End') next = tabKeys[tabKeys.length - 1]
        if (!next) return
        event.preventDefault()
        setTab(next)
        const list = event.currentTarget
        const buttons = list && typeof list.querySelectorAll === 'function' ? list.querySelectorAll('[role="tab"]') : []
        const target = buttons[tabKeys.indexOf(next)]
        if (target && typeof target.focus === 'function') target.focus()
      }

      const openAction = (action) => {
        if (!action) return
        if (action.sessionId) setSelected(action.sessionId)
        setTab(action.tab === 'settings' ? 'settings' : action.tab === 'events' ? 'events' : 'trend')
        if (action.anchor) {
          setTimeout(() => {
            try { document.querySelector(`[data-embodiment-card="${action.anchor}"]`)?.scrollIntoView({ block: 'start' }) } catch {}
          }, 80)
        }
      }

      const headerSessionId = activeSession || (liveForHeader && liveForHeader.sessionId) || null
      const headerSession = headerSessionId
        ? (detail && detail.session && detail.session.id === headerSessionId ? detail.session : null)
          || (analytics && Array.isArray(analytics.sessions) ? analytics.sessions.find((session) => session.id === headerSessionId) : null)
        : null
      const headerAggregate = headerSessionId && analytics && Array.isArray(analytics.sessions)
        ? analytics.sessions.find((session) => session.id === headerSessionId)
        : null
      const headerMeta = headerAggregate || headerSession
      const latestForSession = activeSession && latest && latest.id === activeSession ? latest : null
      const headerUsed = liveForHeader && typeof liveForHeader.used === 'number' ? liveForHeader.used : latestForSession && typeof latestForSession.totalTokens === 'number' ? latestForSession.totalTokens : null
      const headerBudget = liveForHeader && typeof liveForHeader.budget === 'number' ? liveForHeader.budget : typeof budget.tokens === 'number' ? budget.tokens : null
      const headerRatio = headerUsed !== null && headerBudget !== null && headerBudget > 0 ? headerUsed / headerBudget : null
      const headerWarnAt = liveForHeader && typeof liveForHeader.warnAt === 'number' ? liveForHeader.warnAt : typeof budget.warnAt === 'number' ? budget.warnAt : 0.75
      const headerErrorAt = liveForHeader && typeof liveForHeader.errorAt === 'number' ? liveForHeader.errorAt : typeof budget.errorAt === 'number' ? budget.errorAt : 0.9
      const headerDetailMatches = Boolean(headerSessionId && detail && detail.session && detail.session.id === headerSessionId)
      const headerRequests = headerDetailMatches && Array.isArray(detail.requests) ? detail.requests.length : headerMeta && typeof headerMeta.requests === 'number' ? headerMeta.requests : null
      let headerCost = headerMeta && typeof headerMeta.cost === 'number' ? headerMeta.cost : null
      if (headerDetailMatches && typeof detail.session.cost === 'number') headerCost = detail.session.cost
      const headerBreakdown = (liveForHeader && liveForHeader.breakdown) || (latestForSession && latestForSession.breakdown) || null
      const headerCategories = breakdownCategories(t, headerBreakdown)
      const hasHeaderComposition = headerCategories.some((row) => (Number(row.tokens) || 0) > 0)
      const headerParts = []
      if (headerSession && headerSession.title) headerParts.push(`${t('sessionLabel')} ${headerSession.title}`)
      if (headerUsed !== null && headerBudget !== null && headerBudget > 0) {
        headerParts.push(`${t('ratio')} ${compactTokens(headerUsed)} / ${compactTokens(headerBudget)}（${formatPercent(headerRatio, 0)}，${t('pluginBudgetTag')}）`)
        headerParts.push(`${t('remaining')} ${compactTokens(Math.max(0, headerBudget - headerUsed))}`)
      } else if (headerMeta && typeof headerMeta.tokens === 'number') {
        // 历史会话可能不在当前进程的 live 表里；此时至少给出该会话累计 tokens，而不是让头部空着。
        headerParts.push(`${t('kpiTokens')} ${compactTokens(headerMeta.tokens)}`)
      }
      if (headerRequests !== null) headerParts.push(`${headerRequests} ${t('requestsUnit')}`)
      if (headerCost !== null) headerParts.push(`${t('costEstimateLabel')} ${formatCost(headerCost)}`)
      const headerLine = headerParts.length > 0 ? headerParts.join(' · ') : t('description')

      const children = [
        h('div', { key: 'header', style: styles.headerCard },
          h('div', { style: styles.headerRow },
            h('h2', { style: styles.title }, props.title || t('title')),
            data && data.version ? h('span', { style: styles.versionChip, title: `${t('versionLabel')}: ${data.version}`, 'data-embodiment-version': String(data.version) }, `v${data.version}`) : null,
            h('span', { style: styles.headerSpacer }),
            control.active ? h(StatusBadge, { t, state: control.compacting ? 'warn' : 'ok', label: control.compacting ? t('compacting') : undefined }) : null,
            h('button', { type: 'button', style: styles.button, onClick: reloadAll, 'data-embodiment-refresh': '1' }, t('refresh')),
          ),
          h('p', { style: styles.subtitle, 'data-embodiment-header-status': '1' }, headerLine),
          hasHeaderComposition
            ? h(SegmentedBar, { t, usedRatio: headerRatio ?? 0, categories: headerCategories, warnAt: headerWarnAt, errorAt: headerErrorAt, ticks: true, tickLabels: { warn: t('warnAt'), error: t('errorAt') } })
            : null,
          hasHeaderComposition ? h(LegendGrid, { categories: headerCategories, tokensLabel: t('tokens') }) : null,
          h('div', { style: styles.tabs, role: 'tablist', 'aria-label': t('tabsLabel'), onKeyDown: onTabKeyDown }, tabs.map(([key, label]) =>
            h('button', {
              key,
              type: 'button',
              role: 'tab',
              id: tabDomId(key),
              'aria-selected': tab === key ? 'true' : 'false',
              'aria-controls': panelDomId(key),
              // 只有当前 tab 留在 Tab 键序列里，方向键切换时把焦点送到新 tab。
              tabIndex: tab === key ? 0 : -1,
              style: { ...styles.tab, ...(tab === key ? styles.tabActive : null) },
              onClick: () => setTab(key),
              'data-embodiment-tab': key,
            }, label),
          )),
          tab === 'overview' ? h('div', { style: styles.rangeRow },
            [['7d', t('range7')], ['30d', t('range30')], ['all', t('rangeAll')]].map(([key, label]) =>
              h('button', { key, type: 'button', style: { ...styles.rangeBtn, ...(range === key ? styles.rangeBtnOn : null) }, onClick: () => setRange(key), 'data-embodiment-range': key }, label),
            ),
          ) : null,
        ),
      ]

      // 卡片级边界包装：每张卡失败只降级自己，不影响同 tab 的其它卡片。
      const guard = (key, node) => h(CardBoundary, { key, t }, node)
      // tab 专属内容先进 body，最后统一放进 role=tabpanel；内容区再套一层边界，
      // 保证内容区整体失败时面板头部、告警条等仍然可用。
      const body = []
      const renderPanel = () =>
        h('div', { style: styles.root, 'data-embodiment-panel': '1' }, children.concat(
          // 每个 tab 各一个 tabpanel：非当前 tab 的 panel 只作占位（hidden、无内容），
          // 这样每个 tab 的 aria-controls 都能解析到真实节点；只有当前 tab 的 panel 承载内容。
          tabKeys.map((key) => h('div', {
            key,
            role: 'tabpanel',
            id: panelDomId(key),
            'aria-labelledby': tabDomId(key),
            ...(tab === key ? { style: styles.tabPanel } : { hidden: true }),
          }, tab === key ? h(CardBoundary, { t }, body) : null)),
        ))

      if (alertsEnabled) {
        children.push(guard('alerts', h(AlertStrip, {
          t,
          live: liveForHeader,
          control,
          onOpen: (target) => {
            if (typeof target === 'string') setTab(target)
            else openAction(target)
          },
        })))
      }

      if (data && data.onboarding && !data.onboarding.completed && !data.onboarding.dismissed && tab === 'overview') {
        children.push(guard('onboarding', h(OnboardingCard, { t, data, onDone: reloadAll })))
      }

      // 宿主已更新但当前页面还是旧客户端 bundle：提示刷新页面。DSH 的客户端模块
      // 图不会替换已加载的包代码；刷新页面即可，不需要重启整个 DSH。
      if (data && data.version && data.version !== CLIENT_VERSION) {
        children.push(h('div', {
          key: 'versionMismatch',
          style: styles.banner,
          'data-embodiment-version-mismatch': '1',
          title: `${CLIENT_VERSION} → ${data.version}`,
        },
          h('span', null, t('reloadHint')),
          h('button', {
            type: 'button',
            style: styles.button,
            'data-embodiment-reload': '1',
            onClick: () => {
              try {
                globalThis.location.reload()
              } catch {}
            },
          }, t('reloadUi')),
        ))
      }

      if (state.phase === 'loading') {
        body.push(h('div', { key: 'loading', style: styles.card }, h('div', { style: styles.skeletonStack },
          h('div', { style: { ...styles.skeleton, width: '38%', height: '14px' } }),
          h('div', { style: { ...styles.skeleton, width: '100%', height: '84px' } }),
          h('div', { style: { ...styles.skeleton, width: '64%' } }),
        )))
        return renderPanel()
      }
      if (state.phase === 'error') {
        body.push(h('div', { key: 'error', style: styles.emptyState },
          h('p', { style: styles.error }, humanizeError(state.message, t)),
          h('button', { type: 'button', style: styles.button, onClick: reloadAll }, t('retry')),
        ))
        return renderPanel()
      }

      if (tab === 'overview') {
        body.push(guard('kpis', h(KpiBand, { t, kpi: analytics ? analytics.kpi : {}, coverage: analytics ? analytics.coverage : null })))
        if (analytics) body.push(guard('billing', h(BillingCard, { t, kpi: analytics.kpi, pricing: data ? data.pricing : null })))
        if (analytics && analytics.savings) body.push(guard('savings', h(SavingsCard, { t, savings: analytics.savings })))
        if (insightsState.data && Array.isArray(insightsState.data.insights)) {
          body.push(guard('insights', h(InsightCards, { t, insights: insightsState.data.insights, onOpen: openAction })))
        }
        if (analyticsState.error && !analytics) {
          body.push(h('div', { key: 'analyticsError', style: styles.emptyState },
            h('p', { style: styles.error }, humanizeError(analyticsState.error, t)),
            h('button', { type: 'button', style: styles.button, onClick: reloadAnalytics }, t('retry')),
          ))
        } else if (!analytics) {
          body.push(h('div', { key: 'analyticsLoading', style: styles.banner }, t('analyticsLoading')))
        }
        if (analytics) {
          body.push(guard('charts', h('div', { style: styles.card }, h(DailyChart, { t, daily: analytics.daily }))))
        }
        body.push(guard('sessions', h(SessionCards, { t, sessions: analytics ? analytics.sessions : [], selected: detailSession, onSelect: (id) => { setSelected(id); setTab('trend') }, onOpen: (item) => { openSessionInSidebar(item.title || shortSessionId(item.id), item.id) } })))
        if (analytics && Array.isArray(analytics.warnings) && analytics.warnings.length > 0) {
          body.push(h('div', { key: 'warnings', style: styles.banner, title: analytics.warnings.join(' | ') }, `${t('coverage').replace('{scanned}', analytics.coverage.scanned).replace('{total}', analytics.coverage.total)} · ${t('readFailures').replace('{count}', String(analytics.warnings.length))}`))
        }
      } else if (tab === 'trend') {
        body.push(guard('trend', h(TrendCard, { t, detail, error: detailState.error, budget: (liveForHeader && liveForHeader.budget && liveForHeader.budget.tokens) || (latestForSession && latestForSession.budget && latestForSession.budget.tokens) || budget.tokens })))
        if (analytics && Array.isArray(analytics.sessions)) body.push(guard('compare', h(SessionCompare, { t, sessions: analytics.sessions })))
        if (selected) body.push(h('button', { key: 'back', type: 'button', style: styles.button, onClick: () => setSelected(null) }, t('tabsOverview')))
      } else if (tab === 'events') {
        body.push(guard('events', h(EventsCard, { t, logs: control.log || [], detail })))
      } else {
        if (data && data.health) body.push(guard('health', h(HealthCard, { t, health: data.health, control, onDone: reloadAll })))
        // 首次引导跳过/完成后，仍可从设置里重新打开（onboardingReopen 此前已定义但从未渲染）。
        if (data && data.onboarding && (data.onboarding.dismissed || data.onboarding.completed)) {
          body.push(guard('onboarding-reopen', h(OnboardingReopen, { t, data, onDone: reloadAll })))
        }
        // 本会话预算：面板入口，等价 /embody <tokens>；无活动会话时只显示说明。
        body.push(guard('session-budget', h(SessionBudgetCard, {
          t,
          sessionId: activeSession,
          current: latestForSession && latestForSession.override,
          budget: budget.tokens,
          onDone: reloadAll,
        })))
        // 设置页三列各自兜一层：某一列抛错时另外两列照常可用。
        body.push(guard('settings', h('div', { style: styles.cols },
          guard('control', h(ControlSection, { t, control, onToggled: load })),
          guard('config', h(ConfigSection, { t, budget, editable: Boolean(data.configEditable), onSaved: load })),
          guard('balance-display', h(BalanceDisplayCard, { t })),
        )))
        body.push(guard('inventory', h(InventoryCard, { t, data: invState.data, loading: invState.data === null && invState.error === null, error: invState.data === null ? invState.error : null, reload: reloadInv, sessionId: activeSession, controlActive: Boolean(control.active) })))
        body.push(guard('pricing', h(PricingSection, { t, pricing: data ? data.pricing : null, editable: Boolean(data.configEditable), onSaved: load })))
        body.push(guard('data', h(DataCard, { t, range, coverage: analytics ? analytics.coverage : null, alertsEnabled, onAlertsChange: setAlerts, onDone: reloadAll })))
        body.push(guard('labs', h(LabsCard, { t })))
      }
      return renderPanel()
    }
    function CtxPage(props) {
      return h(
        'div',
        { style: styles.page },
        // 再兜一层：面板整体渲染失败时给出可读提示，而不是让宿主边界把主区域整块清空。
        h('div', { style: styles.pageInner }, h(CardBoundary, { t: props.t }, h(CtxPanel, { ...props, title: props.t('pageTitle') }))),
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

    /**
     * 同一个页面里这个包可能被挂载两次（静态 bundle + 后续激活）。
     * DSH 的槽位表不会按同 id 去重，重复 apply 会出现两个 ctx 导航/设置/ dock，
     * 所以用 window 级标记做幂等；插件卸载时由 effect 清除，允许后续重新挂载。
     */
    const MOUNT_FLAG = '__agentEmbodimentMounted'
    const MOUNT_DISPOSERS = '__agentEmbodimentSlotDisposers'
    let mounted = false

    /** @param {unknown} ctx - 浏览器 cordis 上下文（slots / locale） */
