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
        { style: { ...styles.card, ...(props.style || {}) }, 'data-embodiment-card': cardId || undefined, 'data-embodiment-collapsed': collapsed ? '1' : '0' },
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
                  'data-embodiment-card-toggle': cardId,
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

    /** 异常信息转一行可显示的文本（抛出的不一定是 Error，message 也可能为空）。 */
    function boundaryMessage(error) {
      if (error && error.message !== undefined && error.message !== null) {
        const text = String(error.message).trim()
        return text || 'Error'
      }
      const text = String(error === undefined || error === null ? '' : error).trim()
      return text || 'Error'
    }

    /**
     * 卡片级错误边界。
     *
     * 宿主 renderer 只在每个 slot entry 外面套一层 ErrorBoundary：面板内部任何一张卡抛错，
     * 整块面板会一起变空（四个 tab 全没了）。这里在面板内部按卡片再兜一层，某张卡渲染失败时
     * 只把它换成一条可读的降级提示（带“重试”按钮），其余卡片与 tab 继续可用。
     * 正常路径直接返回 children、不额外包 DOM，所以卡片布局与之前完全一致。
     *
     * 用 class 而不是函数组件：React 只有 class 才能实现 error boundary。
     */
    function makeCardBoundary(Base) {
      return class CardBoundary extends Base {
        constructor(props) {
          super(props)
          this.state = { failed: false, message: '' }
          this.retry = this.retry.bind(this)
        }

        static getDerivedStateFromError(error) {
          return { failed: true, message: boundaryMessage(error) }
        }

        /** 重试：清掉失败状态，让子树重新挂载一次；仍然失败会再次落到降级提示。 */
        retry() {
          this.setState({ failed: false, message: '' })
        }

        render() {
          if (!this.state.failed) return this.props.children === undefined ? null : this.props.children
          const t = this.props.t
          const detail = typeof t === 'function'
            ? String(t('cardFailed')).replace('{message}', this.state.message)
            : `This card failed to render: ${this.state.message}`
          return h('div', { style: styles.emptyState, role: 'alert', 'data-embodiment-card-error': '1' },
            // 异常文本一律按纯文本渲染，不用 dangerouslySetInnerHTML。
            h('p', { style: styles.error }, detail),
            h('button', { type: 'button', style: styles.button, onClick: this.retry, 'data-embodiment-card-retry': '1' }, typeof t === 'function' ? t('retry') : 'Retry'),
          )
        }
      }
    }

    // 宿主 react 是完整 React，正常走 class 边界；测试桩等裁剪过的 react 没有 Component，
    // 退回「只渲染 children」的函数组件，保证模块能加载、面板照常显示（只是不再捕获卡内异常）。
    const CardBoundary = typeof react.Component === 'function'
      ? makeCardBoundary(react.Component)
      : function CardBoundary(props) {
        return props && props.children !== undefined ? props.children : null
      }

    // ── 数据 hooks ─────────────────────────────────────────────────────────
    // 同一 URL 的 GET 请求在极短时间内合并：Overview 打开时 CtxPanel 的 useLive(/live)
    // 与 CtxDock 的 fetchLive(/live) 会同时拉同一个会话，这里在飞行期去重，避免双拉。
    const inflightJson = new Map()
    const fetchJson = (path, options) => {
      const key = `${options && options.method === 'POST' ? 'POST' : 'GET'}\u0000${path}`
      const existing = inflightJson.get(key)
      if (existing) return existing
      const promise = fetch(path, { headers: { accept: 'application/json' }, ...(options || {}) })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        })
        .finally(() => {
          // 完成后从 map 移除，避免长期占用内存；下一次请求重新建立。
          setTimeout(() => inflightJson.delete(key), 0)
        })
      inflightJson.set(key, promise)
      return promise
    }

    function useStatus(path) {
      const [state, setState] = react.useState({ phase: 'loading' })
      const load = react.useCallback(() => {
        setState({ phase: 'loading' })
        // fetchJson 已把 Response 解析成 JSON 对象，这里直接取 payload。
        fetchJson(path)
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
    // 会话内容变化（流式输出）会触发一轮 live/inventory/analytics/insights/detail 请求，
    // 3s 节流在「更新跟手」与「请求风暴」之间折中；空闲时 MutationObserver 不触发，不会轮询。
    const USAGE_THROTTLE_MS = 3000
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

    /** Dock 浮层共用状态：开关、点外面/Esc 收起、触发按钮的 hover/展开样式。 */
    function useDock() {
      const [open, setOpen] = react.useState(false)
      const [hovered, setHovered] = react.useState(false)
      const rootRef = react.useRef(null)
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
      const triggerProps = {
        type: 'button',
        style: { ...meter.trigger, ...(hovered || open ? meter.triggerHover : null) },
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      }
      return { open, setOpen, rootRef, triggerProps }
    }

    /** Dock 弹层骨架：标题/百分比/总量 + 内容 + 右下角动作。 */
    function DockPanel(props) {
      return h(
        'div',
        { style: meter.panel, role: 'dialog', 'aria-label': props.label, ...props.attrs },
        h(
          'div',
          { style: meter.header },
          h('span', { style: meter.headline }, props.title),
          props.percent === undefined ? null : h('span', { style: meter.percent }, props.percent),
          props.figures === undefined ? null : h('span', { style: meter.figures }, props.figures),
        ),
        props.children,
        props.action
          ? h(
              'div',
              { style: { marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--dsw-alias-border-l1)', display: 'flex', justifyContent: 'flex-end' } },
              props.action,
            )
          : null,
      )
    }

    /** Dock 弹层明细行：色块 + 名称 + 数值。 */
    function DockRow(props) {
      return h(
        'div',
        { style: meter.row },
        h('dt', null, props.color ? h('span', { style: { ...meter.swatch, background: props.color } }, null) : null, props.label),
        h('dd', { style: meter.figures, title: props.title }, props.value),
      )
    }

    // ── DSH 账号余额：remote.account 是可选服务，注入完成后再显示胶囊 ───────
    let accountRemote = null
    const accountSubscribers = new Set()
    function publishAccountRemote(value) {
      accountRemote = value
      for (const subscriber of accountSubscribers) subscriber(value)
    }
    function useAccountRemote() {
      const [value, setValue] = react.useState(accountRemote)
      react.useEffect(() => {
        accountSubscribers.add(setValue)
        setValue(accountRemote)
        return () => {
          accountSubscribers.delete(setValue)
        }
      }, [])
      return value
    }

    // ── 余额胶囊显示偏好：默认关闭，本机持久化 ───────────────────────────
    const BALANCE_ENABLED_KEY = 'agent-embodiment:balance-enabled:v1'
    const LEGACY_BALANCE_ENABLED_KEY = 'ctx-mon-and-con:balance-enabled:v1'
    /** 常驻 dock 的最小重读间隔：官方无轮询，这里也只在触发点后跳过过密的读。 */
    const BALANCE_READ_MIN_MS = 30000
    const balanceEnabledSubscribers = new Set()
    function readBalanceEnabled() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        return window.localStorage.getItem(BALANCE_ENABLED_KEY) === '1' || window.localStorage.getItem(LEGACY_BALANCE_ENABLED_KEY) === '1'
      } catch {
        return false
      }
    }
    function setBalanceEnabled(value) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(BALANCE_ENABLED_KEY, value ? '1' : '0')
        }
      } catch {}
      for (const subscriber of balanceEnabledSubscribers) subscriber(Boolean(value))
    }
    function useBalanceEnabled() {
      const [enabled, setEnabled] = react.useState(readBalanceEnabled)
      react.useEffect(() => {
        const sync = (value) => setEnabled(value === undefined ? readBalanceEnabled() : Boolean(value))
        balanceEnabledSubscribers.add(sync)
        sync()
        const onStorage = (event) => {
          if (event.key === BALANCE_ENABLED_KEY || event.key === LEGACY_BALANCE_ENABLED_KEY) sync()
        }
        window.addEventListener('storage', onStorage)
        return () => {
          balanceEnabledSubscribers.delete(sync)
          window.removeEventListener('storage', onStorage)
        }
      }, [])
      return enabled
    }

    /** 余额弹层：充值/赠金分项 + 构成条 + 充值入口，布局对齐内置 ContextMeter 面板。 */
    function BalancePanel(props) {
      const t = props.t
      const snapshot = props.snapshot
      const links = props.links || {}
      const ready = Boolean(snapshot && snapshot.status === 'ready')
      const toppedWallets = ready ? snapshot.value || [] : []
      const bonusWallets = ready ? snapshot.bonusWallets || [] : []
      const text = (wallets) => wallets.map((wallet) => formatWalletAmount(wallet.balance, wallet.currency)).join(' / ') || '—'
      const currencies = new Set([...toppedWallets, ...bonusWallets].map((wallet) => wallet.currency))
      const sum = (wallets) => wallets.reduce((total, wallet) => total + (Number(wallet.balance) || 0), 0)
      const toppedAmount = sum(toppedWallets)
      const bonusAmount = sum(bonusWallets)
      const totalAmount = toppedAmount + bonusAmount
      // 账号接口失败时官方给的是"前往开放平台查看"链接，而不是一句死文案。
      const failure = props.failed
        ? links.usageUrl
          ? h('a', { href: links.usageUrl, target: '_blank', rel: 'noreferrer', style: { color: 'inherit' } }, t('balanceCheckPlatform'))
          : t('balanceUnavailable')
        : snapshot === null ? t('balanceSignedOut') : t('balanceLoading')
      return h(
        DockPanel,
        {
          label: t('balance'),
          title: t('balance'),
          percent: ready ? walletSummary(snapshot) || '—' : '—',
          attrs: { 'data-embodiment-balance-panel': '1' },
          action: h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            links.topUpUrl
              ? h('a', { href: links.topUpUrl, target: '_blank', rel: 'noreferrer', style: { ...styles.copyBtn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' } }, t('balanceTopUp'))
              : null,
            h('button', { type: 'button', style: styles.copyBtn, title: t('balanceRefresh'), onClick: () => props.read(true) }, t('refresh')),
          ),
        },
        ready && currencies.size <= 1 && totalAmount > 0
          ? h(
              'div',
              { style: meter.bar },
              toppedAmount > 0 ? h('div', { style: { ...meter.segment, width: `${(toppedAmount / totalAmount) * 100}%`, background: 'var(--dsw-static-blue-450)' } }) : null,
              bonusAmount > 0 ? h('div', { style: { ...meter.segment, width: `${(bonusAmount / totalAmount) * 100}%`, background: '#a78bfa' } }) : null,
            )
          : null,
        ready
          ? h(
              'dl',
              { style: meter.rows },
              h(DockRow, { color: 'var(--dsw-static-blue-450)', label: t('balanceTopped'), value: text(toppedWallets) }),
              h(DockRow, { color: '#a78bfa', label: t('balanceBonus'), value: text(bonusWallets) }),
            )
          : h('p', { style: { margin: '6px 0 0', fontSize: '11px', opacity: 0.7 } }, failure),
      )
    }

    /** 输入框下沿的只读余额胶囊；点击展开充值/赠金明细。 */
    function BalanceDock(props) {
      const t = props.t
      const remote = useAccountRemote()
      const balanceEnabled = useBalanceEnabled()
      const [snapshot, setSnapshot] = react.useState(undefined)
      const [account, setAccount] = react.useState(null)
      const [failed, setFailed] = react.useState(false)
      const { open, rootRef, triggerProps } = useDock()
      const usageTick = useUsageActivity()
      const lastReadRef = react.useRef(0)

      // 登录态与充值/用量链接：与余额分开取，未登录也能拿到链接。
      const readAccount = react.useCallback(() => {
        if (!remote) return undefined
        let cancelled = false
        remote.getState().then((result) => {
          if (!cancelled && result && result.ok) setAccount(result.value ?? null)
        }).catch(() => {})
        return () => {
          cancelled = true
        }
      }, [remote])

      // 常驻 dock 不做轮询：可见性/流式结束只触发，30s 内直接跳过；展开弹层和点刷新强制读。
      const read = react.useCallback((force) => {
        if (!remote || !balanceEnabled) return undefined
        const now = Date.now()
        if (!force && now - lastReadRef.current < BALANCE_READ_MIN_MS) return undefined
        lastReadRef.current = now
        let cancelled = false
        remote.getBalance(props.meta()).then((result) => {
          if (cancelled) return
          const value = result && result.ok ? result.value ?? null : undefined
          if (value === undefined || value.status === 'failed') {
            setFailed(true)
            setSnapshot(undefined)
            return
          }
          setFailed(false)
          setSnapshot(value)
          if (value === null) readAccount()
        }).catch(() => {
          if (cancelled) return
          setFailed(true)
          setSnapshot(undefined)
        })
        return () => {
          cancelled = true
        }
      }, [remote, props.meta, balanceEnabled, readAccount])

      react.useEffect(() => readAccount(), [readAccount])
      react.useEffect(() => read(true), [read])
      react.useEffect(() => {
        const onVisible = () => {
          if (document.visibilityState === 'visible') read()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [read])
      // 流式输出结束后再刷新一次余额，避免每个 DOM 变化都打账号接口。
      react.useEffect(() => {
        if (usageTick === 0) return undefined
        const timer = setTimeout(() => read(), 5000)
        return () => clearTimeout(timer)
      }, [usageTick, read])
      // 展开弹层时拉一次最新余额；点外面或按 Esc 收起。
      react.useEffect(() => {
        if (open) read(true)
      }, [open, read])

      if (!remote || !balanceEnabled) return null
      const ready = Boolean(snapshot && snapshot.status === 'ready')
      const total = ready ? (walletSummary(snapshot) || '—') : '—'
      const topped = ready ? ((snapshot.value || []).map((wallet) => formatWalletAmount(wallet.balance, wallet.currency)).join(' / ') || '—') : null
      const bonus = ready ? (snapshot.bonusWallets || []).filter((wallet) => Number(wallet.balance) > 0).map((wallet) => formatWalletAmount(wallet.balance, wallet.currency)).join(' / ') : ''
      const detail = ready
        ? [`${t('balanceTopped')} ${topped}`, bonus ? `${t('balanceBonus')} ${bonus}` : ''].filter(Boolean).join(' · ')
        : failed ? t('balanceUnavailable') : snapshot === null ? t('balanceSignedOut') : t('balanceLoading')
      return h(
        'span',
        { ref: rootRef, style: meter.root },
        h(
          'button',
          {
            ...triggerProps,
            title: detail,
            'aria-label': `${t('balance')} ${total}`,
            'data-embodiment-balance': '1',
          },
          h('span', null, t('balance')),
          h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' } }, total),
        ),
        open ? h(BalancePanel, { t, snapshot, failed, links: account && account.links, read }) : null,
      )
    }

    /** 打开页面时同步一次 /live；重新可见/窗口聚焦或点刷新时再同步，不做定时轮询。 */
    function useLive(path, refreshKey, enabled = true) {
      const [state, setState] = react.useState({ data: null, at: null, error: null })
      const lastPathRef = react.useRef(path)
      const pathRef = react.useRef(path)
      pathRef.current = path
      const reload = react.useCallback(() => {
        const requestedPath = path
        fetchJson(path)
          .then((payload) => {
            if (pathRef.current !== requestedPath) return
            if (payload && payload.ok) setState({ data: payload, at: new Date().toISOString(), error: null })
            else throw new Error('invalid payload')
          })
          .catch((error) => {
            if (pathRef.current !== requestedPath) return
            setState((previous) => ({ ...previous, error: String((error && error.message) || error) }))
          })
      }, [path])
      // 切会话/切详情时先清掉旧 payload，避免新请求返回前把上一个会话的数据画到新标题下。
      react.useEffect(() => {
        if (lastPathRef.current === path) return
        lastPathRef.current = path
        setState({ data: null, at: null, error: null })
      }, [path])
      react.useEffect(() => {
        if (!enabled) return undefined
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
      }, [reload, refreshKey, enabled])
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
          return ['embody', 'ctx', 'context', '上下文'].includes(label) || ['embody', 'ctx', 'context', '上下文'].includes(text)
        })
        if (target) {
          target.click()
          return true
        }
      } catch {}
      return false
    }

