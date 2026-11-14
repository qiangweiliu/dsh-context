    function apply(ctx) {
      const scope = typeof window !== 'undefined' ? window : null
      // 同一份 bundle 被重复 apply（静态 bundle + 后续激活）：跳过，避免重复导航/设置/dock。
      if (mounted) return undefined
      if (scope && scope[MOUNT_FLAG] === CLIENT_VERSION) return undefined
      mounted = true
      if (scope) {
        // HMR 热更新 client.js 时，必须先把上一个 bundle 留下的槽位注册释放掉。
        // 否则新组件注册不上、旧注册又随旧模块被清理，表现为「侧栏还有入口、主区域空白」。
        const previous = scope[MOUNT_DISPOSERS]
        if (Array.isArray(previous)) {
          for (const dispose of previous) {
            try {
              dispose()
            } catch {}
          }
        }
        scope[MOUNT_FLAG] = CLIENT_VERSION
        scope[MOUNT_DISPOSERS] = []
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            mounted = false
            try {
              delete scope[MOUNT_FLAG]
              delete scope[MOUNT_DISPOSERS]
            } catch {}
          }, 'agent-embodiment: mount guard')
        }
      }
      /** 记录槽位注册的释放函数，供下一个 bundle 挂载前清理。 */
      const track = (dispose) => {
        if (scope && Array.isArray(scope[MOUNT_DISPOSERS]) && typeof dispose === 'function') scope[MOUNT_DISPOSERS].push(dispose)
        return dispose
      }

      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'agent-embodiment: dictionaries')

      // prefers-reduced-motion：关闭本插件面板 / dock 的过渡与动画（不改宿主样式）。
      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.head) return () => {}
        const styleId = 'agent-embodiment-reduced-motion'
        if (document.getElementById(styleId)) return () => {}
        const style = document.createElement('style')
        style.id = styleId
        style.textContent =
          '@media (prefers-reduced-motion: reduce){[data-embodiment-panel],[data-embodiment-panel] *,[data-embodiment-dock],[data-embodiment-dock] *{transition-duration:0.01ms !important;animation-duration:0.01ms !important;animation-iteration-count:1 !important;scroll-behavior:auto !important}}'
        document.head.appendChild(style)
        return () => {
          try {
            style.remove()
          } catch {}
        }
      }, 'agent-embodiment: reduced motion')

      // 事件驱动刷新：监听会话区域的 DOM 变化（流式输出、消息更新、切换会话），2s 节流。
      // 忽略本插件自己的 UI（dock/面板），避免自触发循环。
      ctx.effect(() => {
        if (typeof MutationObserver !== 'function' || !document.body) return () => {}
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
            if (target && typeof target.closest === 'function' && (target.closest('[data-embodiment-dock]') || target.closest('[data-embodiment-panel]'))) continue
            notifyUsageActivity()
            return
          }
        })
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
        return () => observer.disconnect()
      }, 'agent-embodiment: usage activity observer')
      if (typeof ctx.inject === 'function') ctx.inject(['sessions'], (sub) => {
        publishSessionService(sub?.sessions ?? null)
        if (typeof sub.effect === 'function') sub.effect(() => () => { publishSessionService(null) }, 'agent-embodiment: sessions presence')
      })
      // uiWorkspace 提供官方 openSession；优先走它，避免模拟侧栏点击。
      if (typeof ctx.inject === 'function') ctx.inject(['uiWorkspace'], (sub) => {
        workspaceService = sub?.uiWorkspace ?? null
        if (typeof sub.effect === 'function') sub.effect(() => () => { workspaceService = null }, 'agent-embodiment: uiWorkspace presence')
      })
      // 账号余额来自 DSH 官方 remote.account；没有账号扩展时自动隐藏胶囊。
      if (typeof ctx.inject === 'function') ctx.inject(['remote', 'remote.account'], (sub) => {
        publishAccountRemote(sub?.remote?.account ?? null)
        if (typeof sub.effect === 'function') sub.effect(() => () => { publishAccountRemote(null) }, 'agent-embodiment: account presence')
      })
      const t = ctx.locale.bind(NS)
      const face = () => ({ t })
      const accountMeta = () => ({
        version: CLIENT_VERSION,
        locale: ctx.locale.getSnapshot?.()?.active || 'zh',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })

      // 1) 设置 → 上下文
      ctx.slots.inject('settings.section', () =>
        track(
          ctx.slots.register(
            { name: 'settings.section', id: CONFIG_NAMESPACE, order: 40, locale: NS, label: () => t('nav'), inject: face },
            CtxPanel,
          ),
        ),
      )

      // 2) 左侧导航整页 + 图标
      ctx.slots.inject('main', () => track(ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: face }, CtxPage)))
      ctx.slots.inject('sidebar.panellist', () =>
        track(ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, CtxIcon)),
      )

      // 3) 输入框下方指示器（与内置 ContextMeter 同排版，可点开小明细）
      ctx.slots.inject('conversation.composer.dock', () =>
        track(ctx.slots.register({ name: 'conversation.composer.dock', id: 'embody-usage', order: 10, locale: NS, inject: face }, (props) => {
          const [active, setActive] = react.useState(false)
          react.useEffect(() => {
            let cancelled = false
            fetchJson(STATUS_PATH)
              .then((payload) => {
                if (!cancelled && payload && payload.control) setActive(Boolean(payload.control.active))
              })
              .catch(() => {})
            return () => {
              cancelled = true
            }
          }, [])
          return h(CtxDock, { ...props, t, controlActive: active })
        })),
      )

      // 4) 同一个底部状态行里的 DSH 余额胶囊，排在 ctx 指示器之后。
      ctx.slots.inject('conversation.composer.dock', () =>
        track(
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'embody-balance', order: 20, locale: NS, inject: face },
            (props) => h(BalanceDock, { ...props, t, meta: accountMeta }),
          ),
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
