    function KpiBand(props) {
      const t = props.t
      const kpi = props.kpi || {}
      const items = [
        { key: 'sessions', label: t('kpiSessions'), value: formatTokens(kpi.sessions), sub: props.coverage ? t('coverageShort').replace('{scanned}', props.coverage.scanned).replace('{total}', props.coverage.total) : '' },
        { key: 'tokens', label: t('kpiTokens'), value: compactTokens(kpi.tokens), sub: `≈ ${formatTokens(kpi.tokens)} tokens` },
        { key: 'cache', label: t('kpiCache'), value: formatPercent(kpi.cacheHit, 1), sub: `${compactTokens(kpi.cacheRead || 0)} cache` },
        { key: 'tools', label: t('kpiTools'), value: formatTokens(kpi.toolCalls), sub: '' },
        { key: 'active', label: t('kpiActive'), value: formatDurationMs(kpi.activeMs), sub: '' },
        { key: 'compactions', label: t('kpiCompactions'), value: formatTokens(kpi.compactions), sub: kpi.injections ? `${formatTokens(kpi.injections)} inject` : '' },
      ]
      return h('div', { style: styles.kpiBand, 'data-embodiment-kpis': '1' }, items.map((item, index) => h('div', { key: item.key, style: index > 0 ? { ...styles.kpiCard, ...styles.kpiCardDivider } : styles.kpiCard, 'data-embodiment-kpi': item.key },
        h('span', { style: styles.kpiCardLabel }, item.label),
        h('strong', { style: styles.kpiCardValue }, item.value),
        item.sub ? h('span', { style: styles.kpiCardSub }, item.sub) : null,
      )))
    }

    /** 计费卡：把官方价目按缓存命中/未命中/输出拆开，展示 token → 人民币。 */
    function BillingCard(props) {
      const t = props.t
      const kpi = props.kpi || {}
      const parts = kpi.costParts || {}
      const pricing = props.pricing || {}
      const models = Array.isArray(pricing.models) ? pricing.models : []
      const flash = models.find((model) => /flash/i.test(model.id)) || models[0] || null
      const peak = typeof pricing.peakNow === 'boolean' ? pricing.peakNow : null
      const rate = flash && peak !== null ? (peak ? flash.peak : flash.offPeak) : null
      const rows = [
        { key: 'cacheRead', label: t('costCacheHit'), tokens: kpi.cacheRead, cost: parts.cacheRead },
        { key: 'input', label: t('costCacheMiss'), tokens: kpi.input, cost: parts.input },
        { key: 'cacheWrite', label: t('costCacheWrite'), tokens: kpi.cacheWrite, cost: parts.cacheWrite },
        { key: 'output', label: t('costOutput'), tokens: kpi.output, cost: parts.output },
      ].filter((row) => (Number(row.tokens) || 0) > 0 || (Number(row.cost) || 0) > 0)
      const note = rate
        ? `${t('costRateExample')} ${flash.label} · ${t('costNow')}：${peak ? t('costPeak') : t('costOffPeak')} · ${t('costCacheHit')} ¥${rate.cacheRead} · ${t('costCacheMiss')} ¥${rate.input} · ${t('costOutput')} ¥${rate.output} / ${t('costRateUnit')}`
        : t('costPricingNote')
      return h('div', { style: styles.card, 'data-embodiment-billing': '1' },
        h('div', { style: styles.cardHead },
          h('h3', { style: styles.cardTitle }, t('billingTitle')),
          h('span', { style: styles.cardSub }, `${pricing.currency || 'CNY'} · ${t('costEstimated')}${pricing.custom ? ` · ${t('costCustom')}` : ''}`),
        ),
        h('div', { style: styles.billingBody },
          h('div', { style: styles.billingTotal },
            h('span', { style: styles.billingTotalLabel }, t('costTotal')),
            h('strong', { style: styles.billingTotalValue, 'data-embodiment-billing-total': '1' }, formatCost(kpi.cost)),
          ),
          h('div', { style: styles.billingRows }, rows.map((row) => h('div', { key: row.key, style: styles.billingRow, 'data-embodiment-billing-row': row.key },
            h('span', { style: styles.billingRowLabel }, row.label),
            h('span', { style: styles.billingRowTokens }, `${compactTokens(row.tokens)} tokens`),
            h('span', { style: styles.billingRowCost }, formatCost(row.cost)),
          ))),
        ),
        h('p', { style: styles.billingNote, title: pricing.source || '' }, note),
      )
    }

    function DailyChart(props) {
      const t = props.t
      const daily = Array.isArray(props.daily) ? props.daily : []
      const max = Math.max(1, ...daily.map((day) => Number(day.tokens) || 0))
      const total = daily.reduce((sum, day) => sum + (Number(day.tokens) || 0), 0)
      const ariaLabel = daily.length === 0
        ? t('dailyTitle')
        : `${t('dailyTitle')}：${daily.map((day) => `${String(day.date).slice(5)} ${formatTokens(Number(day.tokens) || 0)}`).join('，')}`
      return h('div', { style: styles.chartWrap, 'data-embodiment-daily': '1', role: 'img', 'aria-label': ariaLabel },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('dailyTitle')), h('span', { style: styles.cardSub }, `${compactTokens(total)} tokens`)),
        h('div', { style: styles.chartBars }, daily.map((day) => {
          const value = Number(day.tokens) || 0
          const ratio = value / max
          return h('div', { key: day.date, style: styles.chartBarCol, title: `${day.date} · ${formatTokens(value)} tokens · ${day.requests} req` },
            h('div', { style: { ...styles.chartBar, ...(value === 0 ? styles.chartBarZero : null), height: `${Math.max(2, ratio * 100)}%` } }),
            h('span', { style: styles.chartLabel }, String(day.date).slice(5)),
          )
        })),
      )
    }

    /**
     * 优先用官方 uiWorkspace.openSession 切换主视图；没有该服务时回退到
     * role=treeitem 的侧栏会话行（pointer 序列），避免只按文字找到错误节点。
     */
    function openSessionInSidebar(title, sessionId) {
      if (workspaceService && typeof workspaceService.openSession === 'function' && sessionId) {
        try {
          workspaceService.openSession(sessionId)
          return true
        } catch {}
      }
      if (!title || typeof document === 'undefined') return false
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim()
      const containers = Array.from(document.querySelectorAll('[role="tree"], aside, nav, [class*="sidebar"], [class*="Sidebar"]'))
      for (const container of containers) {
        const target = Array.from(container.querySelectorAll('[role="treeitem"], button, [role="button"], a')).find((element) => {
          const text = norm(element.textContent)
          return text === title || (text.startsWith(title) && text.length <= title.length + 24)
        })
        if (target) {
          // 会话树行是 role=treeitem 的 div，监听的是 pointer 序列；单纯 click() 在桌面端不生效。
          const rect = target.getBoundingClientRect()
          const x = Math.round(rect.left + rect.width / 2)
          const y = Math.round(rect.top + rect.height / 2)
          const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: x, clientY: y }
          const fire = (type) => {
            const usePointer = type.startsWith('pointer') && typeof PointerEvent === 'function'
            const event = usePointer
              ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: type.endsWith('down') ? 1 : 0 })
              : new MouseEvent(type, { ...eventInit, buttons: type.endsWith('down') ? 1 : 0, detail: 1 })
            target.dispatchEvent(event)
          }
          // 从会话卡的 click 处理器里同步派发到侧栏行会被 React 的当前事件批次吞掉；挪到下一拍。
          window.setTimeout(() => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) fire(type) }, 0)
          return true
        }
      }
      return false
    }

    function SessionCards(props) {
      const t = props.t
      const sessions = Array.isArray(props.sessions) ? props.sessions : []
      const [query, setQuery] = react.useState('')
      const [sort, setSort] = react.useState('recent')
      const [expanded, setExpanded] = react.useState(false)
      const needle = query.trim().toLowerCase()
      const totalCost = sessions.reduce((sum, item) => sum + (typeof item.cost === 'number' ? item.cost : 0), 0)
      const maxCost = sessions.reduce((max, item) => Math.max(max, typeof item.cost === 'number' ? item.cost : 0), 0)
      const sortKey = (item) => (sort === 'tokens' ? (item.tokens || 0) : sort === 'cost' ? (item.cost || 0) : (item.lastActivityAt || 0))
      const filtered = sessions
        .filter((item) => {
          if (!needle) return true
          return [item.title, item.cwd, item.id, item.model].some((value) => String(value || '').toLowerCase().includes(needle))
        })
        .slice()
        .sort((a, b) => sortKey(b) - sortKey(a))
      const visible = expanded ? filtered : filtered.slice(0, 12)
      const base = (item) => (String(item || '').split(/[\\/]/).filter(Boolean).pop() || '—')
      return h('div', { style: styles.card, 'data-embodiment-sessions': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('sessionsTitle')), h('span', { style: styles.cardSub }, `${filtered.length}/${sessions.length}`)),
        h('div', { style: styles.filterBar },
          h('input', { style: styles.searchInput, value: query, placeholder: t('searchSessions'), onChange: (event) => setQuery(event.target.value), 'data-embodiment-session-search': '1' }),
          h('button', { type: 'button', style: { ...styles.filterToggle, ...(sort === 'recent' ? styles.filterToggleOn : null) }, onClick: () => setSort('recent') }, t('sortRecent')),
          h('button', { type: 'button', style: { ...styles.filterToggle, ...(sort === 'tokens' ? styles.filterToggleOn : null) }, onClick: () => setSort('tokens') }, t('sortTokens')),
          totalCost > 0 ? h('button', { type: 'button', style: { ...styles.filterToggle, ...(sort === 'cost' ? styles.filterToggleOn : null) }, onClick: () => setSort('cost'), 'data-embodiment-sort': 'cost' }, t('sortCost')) : null,
        ),
        filtered.length === 0 ? h('p', { style: styles.emptyText }, t('noSessions')) : h('div', { style: styles.sessionList }, visible.map((item) =>
          h('div', {
            key: item.id,
            role: 'button',
            tabIndex: 0,
            style: { ...styles.sessionCard, ...(props.selected === item.id ? styles.sessionCardOn : null) },
            onClick: () => props.onSelect(item.id),
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelect(item.id) } },
            title: item.id,
            'data-embodiment-session-card': item.id,
          },
            h('p', { style: styles.sessionTitle }, item.title || shortSessionId(item.id)),
            h('span', { style: styles.sessionMeta }, `${base(item.cwd)} · ${item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : '—'}`),
            h('div', { style: styles.sessionStats },
              h('span', null, `${compactTokens(item.tokens)} tokens`),
              h('span', null, `${formatTokens(item.turns)} ${t('turnsLabel')}`),
              h('span', null, `${formatTokens(item.requests)} ${t('requestsLabel')}`),
              item.cost !== null && item.cost !== undefined ? h('span', { style: item.cost > 0 && item.cost === maxCost ? { color: 'var(--dsw-alias-state-warn-primary)' } : null, title: totalCost > 0 ? `${Math.round(((item.cost || 0) / totalCost) * 100)}%` : '' }, `${t('costEstimateLabel')} ${formatCost(item.cost)}`) : null,
              item.compactions > 0 ? h('span', null, `${formatTokens(item.compactions)}×` ) : null,
            ),
            h('button', {
              type: 'button',
              style: { ...styles.linkAction, border: 0, background: 'transparent', padding: 0 },
              onClick: (event) => { event.preventDefault(); event.stopPropagation(); if (props.onOpen) props.onOpen(item) },
              'data-embodiment-session-open': item.id,
            }, `${t('openSession')} ↗`),
          ),
        )),
        filtered.length > 12 ? h('button', { type: 'button', style: styles.button, onClick: () => setExpanded((value) => !value), 'data-embodiment-session-more': '1' }, expanded ? t('showLess') : t('showMore')) : null,
      )
    }

    function TrendCard(props) {
      const t = props.t
      const detail = props.detail
      if (!detail) {
        return h('div', { style: styles.card }, h('h3', { style: styles.cardTitle }, t('trendTitle')), props.error ? h('p', { style: styles.error }, `${t('analyticsError')}: ${props.error}`) : h('div', { style: styles.skeletonStack }, h('div', { style: { ...styles.skeleton, width: '100%', height: '120px' } })))
      }
      const allRequests = Array.isArray(detail.requests) ? detail.requests : []
      const requests = allRequests.slice(-40)
      const compactions = Array.isArray(detail.compactions) ? detail.compactions : []
      if (requests.length === 0) return h('div', { style: styles.card }, h('h3', { style: styles.cardTitle }, t('trendTitle')), h('p', { style: styles.emptyText }, t('trendNoData')))
      const series = requests.map((item) => {
        const prompt = Number(item.prompt) || 0
        const output = Number(item.output) || 0
        return { item, prompt, output, total: prompt + output }
      })
      const maxTotal = Math.max(1, ...series.map((entry) => entry.total))
      const budget = Number(props.budget) || 0
      // 预算离峰值不远时把纵轴抬到预算，让预算线留在图内；差太远则按峰值缩放，
      // 避免柱子被压成贴地的一条线（预算关系放到右上角摘要里）。
      const axisCeiling = budget > 0 && budget <= maxTotal * 1.6 ? Math.max(maxTotal, budget) : maxTotal
      const axisMax = niceAxisMax(axisCeiling)
      const barMax = 112
      const peakShare = budget > 0 ? maxTotal / budget : null
      const budgetTop = budget > 0 && budget <= axisMax ? barMax - (budget / axisMax) * barMax : null
      const showBudgetLine = budgetTop !== null && budgetTop >= 14
      const sub = allRequests.length > requests.length
        ? `${requests.length} / ${allRequests.length} ${t('requestsUnit')}`
        : `${requests.length} ${t('requestsUnit')}`
      const costTotal = typeof detail.session.cost === 'number' ? detail.session.cost : series.reduce((sum, entry) => sum + (typeof entry.item.cost === 'number' ? entry.item.cost : 0), 0)
      const costKnown = typeof detail.session.cost === 'number' || series.some((entry) => typeof entry.item.cost === 'number')
      const legendItem = (color, label, shape) => h('span', { style: styles.trendLegendItem },
        h('i', { style: { width: shape === 'line' ? '10px' : '8px', height: shape === 'line' ? '2px' : '8px', borderRadius: '2px', background: color, display: 'inline-block', flex: 'none' } }),
        label,
      )
      const timeText = (time) => {
        if (!time) return '—'
        try { return new Date(time).toLocaleTimeString() } catch { return '—' }
      }
      return h('div', { style: { ...styles.card, ...styles.cardFill }, 'data-embodiment-trend': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('trendTitle')), h('span', { style: styles.cardSub }, `${sub}${costKnown ? ` · ${formatCost(costTotal)}` : ''}`)),
        h('div', { style: styles.legendInline },
          legendItem('var(--dsw-static-blue-450)', t('trendPrompt')),
          legendItem('var(--dsw-static-green-400)', t('trendOutput')),
          legendItem('var(--dsw-alias-state-warn-primary)', t('trendCompaction'), 'line'),
          h('span', { style: { ...styles.trendLegendItem, marginLeft: 'auto' } },
            peakShare === null
              ? `${t('trendPeak')} ${compactTokens(maxTotal)}`
              : `${t('trendPeak')} ${compactTokens(maxTotal)} / ${compactTokens(budget)}（${formatPercent(peakShare, 0)}）`,
          ),
        ),
        h('div', { style: styles.trendBody, role: 'img', 'aria-label': `${t('trendTitle')}：${series.map((entry, index) => `#${index + 1} ${t('trendPrompt')} ${formatTokens(entry.prompt)} ${t('trendOutput')} ${formatTokens(entry.output)}`).join('，')}` },
          h('div', { style: styles.trendAxis },
            h('span', null, compactTokens(axisMax)),
            h('span', null, compactTokens(axisMax / 2)),
            h('span', null, '0'),
          ),
          h('div', { style: styles.trendScroll }, h('div', { style: styles.trendCols },
            [0, 50, 100].map((percent) => h('div', { key: `grid-${percent}`, style: { ...styles.trendGridLine, top: `${(barMax * percent) / 100}px` } })),
            showBudgetLine ? h('div', { key: 'budget', style: { ...styles.trendGridLine, top: `${budgetTop}px`, borderTop: '1px dashed var(--dsw-alias-label-tertiary)' }, title: `${t('budgetLine')} ${formatTokens(budget)}` }, h('span', { style: styles.trendBudgetLabel }, `${t('budgetLine')} ${compactTokens(budget)}`)) : null,
            series.map((entry, index) => {
              const totalHeight = Math.max(2, Math.round((entry.total / axisMax) * barMax))
              const promptHeight = entry.total > 0 ? Math.max(1, Math.round((entry.prompt / entry.total) * totalHeight)) : 1
              const outputHeight = Math.max(0, totalHeight - promptHeight)
              const previousCompaction = index > 0 ? series[index - 1].item.compaction : null
              const marker = index > 0 && entry.item.compaction && (!previousCompaction || previousCompaction.endedAt !== entry.item.compaction.endedAt)
              const turn = entry.item.turn !== null && entry.item.turn !== undefined ? `T${entry.item.turn}` : '—'
              const title = `#${index + 1} · ${timeText(entry.item.time)} · ${turn} · ${t('trendPrompt')} ${formatTokens(entry.prompt)} · ${t('trendOutput')} ${formatTokens(entry.output)} · ${formatTokens(entry.total)}${typeof entry.item.cost === 'number' ? ` · ${formatCost(entry.item.cost)}` : ''}${marker ? ` · ${t('trendAfterCompaction')}` : ''}`
              return h('div', { key: `${entry.item.time}-${index}`, style: styles.trendCol, title },
                marker ? h('div', { style: styles.trendMarker, title: t('trendAfterCompaction') }, h('span', { style: styles.trendMarkerDot })) : null,
                h('div', { style: { ...styles.trendOutput, height: `${outputHeight}px` } }),
                h('div', { style: { ...styles.trendPrompt, height: `${promptHeight}px` } }),
                h('span', { style: styles.trendLabel }, `#${index + 1}`),
              )
            }),
          )),
        ),
        h('div', { style: styles.banner, 'data-embodiment-detail-session': detail.session ? detail.session.id : '' }, `${detail.session && detail.session.title ? detail.session.title : '—'} · ${t('requestsLabel')} ${detail.requests.length} · ${detail.session && detail.session.lastActivityAt ? new Date(detail.session.lastActivityAt).toLocaleString() : '—'}`),
        compactions.length > 0 ? h('div', { style: styles.logBox }, h('div', { style: styles.logToggle }, `${t('eventCompaction')} · ${compactions.length}`), h('ul', { style: styles.logList }, compactions.slice(-8).reverse().map((item) =>
          h('li', { key: `${item.at}-${item.turn}`, style: styles.logItem },
            h('div', { style: styles.logLine },
              h('span', { style: styles.logTime }, item.at ? new Date(item.at).toLocaleTimeString() : '—'),
              h('span', { style: styles.logMain }, `${formatTokens(item.shadowedTokens)} tokens`),
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
      return h('div', { style: styles.card, 'data-embodiment-events': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('eventsTitle')), h('span', { style: styles.cardSub }, `${filtered.length}/${logs.length}${injectionCount > 0 ? ` · ${injectionCount} ${t('eventInject')}` : ''}`)),
        h('div', { style: styles.filterBar },
          [['all', t('eventAll')], ['success', t('eventSuccess')], ['failure', t('eventFailure')]].map(([key, label]) =>
            h('button', { key, type: 'button', style: { ...styles.filterToggle, ...(filter === key ? styles.filterToggleOn : null) }, onClick: () => setFilter(key) }, label),
          ),
        ),
        filtered.length === 0 ? h('p', { style: styles.emptyText }, t('noEvents')) : h('ul', { style: styles.eventList }, filtered.map((entry) => {
          const success = entry.outcome === 'success'
          return h('li', { key: entry.id, style: styles.eventItem, 'data-embodiment-event': entry.outcome },
            h('span', { style: { ...styles.eventKind, color: success ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, success ? t('eventSuccess') : t('eventFailure')),
            h('div', { style: styles.eventMain },
              h('div', null, entry.before || entry.after ? `${t('beforeAfter')}: ${formatTokens(entry.before)} → ${formatTokens(entry.after)}${entry.target ? ` · ${t('targetLine')} ${formatTokens(entry.target)}` : ''}` : `${t('targetLine')} ${formatTokens(entry.target)}`),
              h('div', { style: styles.sessionMeta }, `${entry.trigger || '—'}${entry.rounds !== null && entry.rounds !== undefined ? ` · ${t('roundsLabel')} ${entry.rounds}` : ''}${entry.durationMs !== null && entry.durationMs !== undefined ? ` · ${t('durationLabel')} ${formatDurationMs(entry.durationMs)}` : ''}${entry.shadowed ? ` · ${formatTokens(entry.shadowed)} tokens` : ''}`),
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

    /** Agent Embodiment Scaffold：模板 → 预览 → 生成（写盘由宿主路由完成）。 */
