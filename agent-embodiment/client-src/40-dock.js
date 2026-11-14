    function CtxDock(props) {
      const t = props.t
      const selectedSession = useCurrentSession()
      const sessionId = props.sessionId || (props.runtime && props.runtime.sessionId) || selectedSession || undefined
      const [data, setData] = react.useState(null)
      const { open, setOpen, rootRef, triggerProps } = useDock()
      const usageTick = useUsageActivity()
      const sessionRef = react.useRef(sessionId)
      sessionRef.current = sessionId

      const fetchLive = react.useCallback(() => {
        if (!sessionId) return
        const requestedSession = sessionId
        fetchJson(`${STATUS_PATH}/live?sessionId=${encodeURIComponent(String(sessionId))}`)
          .then((payload) => {
            if (sessionRef.current !== requestedSession) return
            if (payload && payload.ok) setData(payload)
          })
          .catch(() => {})
      }, [sessionId])

      // 打开会话时同步一次触发器；随后补一次延迟同步（等首次装配完成），窗口重新可见/聚焦时也同步。
      // 不是定时轮询：只在挂载、会话变化、可见性变化时各取一次。
      react.useEffect(() => {
        setData(null)
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

      const budget = data && typeof data.budget === 'number' ? data.budget : null
      const used = data && typeof data.used === 'number' ? data.used : null
      const compacting = Boolean(data && data.compacting)
      const budgetText = budget === null ? '—' : formatTokens(budget)
      const budgetShort = budget === null ? '—' : compactTokens(budget)
      const usedShort = used === null ? '—' : compactTokens(used)
      const remaining = used === null || budget === null ? null : Math.max(0, budget - used)
      // 与内置 ContextMeter 同一读法：环形 + 百分比。分母是插件为本会话配置的
      // 上下文上限（含会话级覆盖），不是模型窗口；token 构成仍由官方指示器负责。
      const percent = used === null || budget === null || budget <= 0 ? null : Math.min(100, Math.round((used / budget) * 100))
      const percentText = percent === null ? null : `${percent}%`
      const label = compacting
        ? `${t('pluginContext')} · ${t('compacting')}`
        : percent === null
          ? `${t('pluginContext')} ${budgetShort}`
          : `${t('pluginContext')} ${percentText}`
      const aria = percent === null
        ? `${t('pluginContext')} ${budgetText}`
        : t('pluginContextAria').replace('{percent}', percentText)

      return h(
        'span',
        { ref: rootRef, style: meter.root },
        h(
          'button',
          {
            ...triggerProps,
            'aria-label': aria,
            title: `${aria} · ${usedShort} / ${budgetShort}${props.controlActive ? ` · ${t('controlOn')}` : ` · ${t('controlOff')}`}`,
            'data-embodiment-dock': '1',
            'data-embodiment-dock-percent': percent === null ? '' : String(percent),
          },
          h(ContextRing, { percent: percent === null ? 0 : percent }),
          h('span', null, label),
          props.controlActive
            ? null
            : h('span', {
                'data-embodiment-dock-warning': '1',
                title: t('controlOff'),
                style: { marginLeft: '2px', color: 'var(--dsw-alias-state-warn-primary)', fontSize: '11px', lineHeight: 1 },
              }, '⚠'),
        ),
        open
          ? h(
              DockPanel,
              {
                label: t('pluginContext'),
                title: t('pluginContext'),
                percent: percentText === null ? undefined : percentText,
                figures: `${usedShort} / ${budgetShort}`,
                action: h(
                  'button',
                  { type: 'button', style: styles.copyBtn, 'data-embodiment-open-panel': '1', onClick: () => { setOpen(false); openCtxPanelPage() } },
                  t('openPanel'),
                ),
              },
              h(
                'dl',
                { style: meter.rows },
                h(DockRow, { label: t('used'), value: `${usedShort} ${t('tokens')}`, title: used === null ? '—' : `${formatTokens(used)} ${t('tokens')}` }),
                h(DockRow, { label: t('budgetLimit'), value: `${budgetShort} ${t('tokens')}`, title: `${budgetText} ${t('tokens')}` }),
                h(DockRow, { label: t('remaining'), value: remaining === null ? '—' : `${compactTokens(remaining)} ${t('tokens')}`, title: remaining === null ? '—' : `${formatTokens(remaining)} ${t('tokens')}` }),
                h(DockRow, { label: t('control'), value: props.controlActive ? t('controlOn') : t('controlOff') }),
                h('p', { style: { margin: '6px 0 0', fontSize: '11px', opacity: 0.7 } }, t('pluginContextHint')),
              ),
            )
          : null,
      )
    }

    // ── 面板内部区块 ───────────────────────────────────────────────────────
    /** 本会话工具 / 提示词 section 清单：两级折叠 + 会话/全局开关 + 展开看原文。 */
