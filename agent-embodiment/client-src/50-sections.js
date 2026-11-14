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
          ? h('p', { style: styles.error, 'data-embodiment-lasterror': '1' }, `${t('controlError')}: ${control.lastError}`)
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
      )
    }

    /** 余额胶囊显示开关：默认关闭，偏好保存在 localStorage。 */
    function BalanceDisplayCard(props) {
      const t = props.t
      const enabled = useBalanceEnabled()
      return h(
        Card,
        { title: t('balanceToggleTitle'), id: 'balance-display', t, style: styles.cardFill },
        h('p', { style: styles.text }, t('balanceToggleHint')),
        h(
          'div',
          { style: styles.actionRow },
          h(
            'button',
            {
              type: 'button',
              style: { ...styles.filterToggle, ...(enabled ? styles.filterToggleOn : null) },
              'aria-pressed': enabled,
              'data-embodiment-balance-toggle': '1',
              'data-embodiment-balance-enabled': enabled ? '1' : '0',
              onClick: () => setBalanceEnabled(!enabled),
            },
            enabled ? t('balanceDisable') : t('balanceEnable'),
          ),
        ),
      )
    }

    const STRATEGY_PRESETS = {
      conservative: { trigger: 0.9, target: 0.7 },
      balanced: { trigger: 0.9, target: 0.6 },
      aggressive: { trigger: 0.75, target: 0.5 },
    }

    function ConfigSection(props) {
      const t = props.t
      const budget = props.budget || {}
      const editable = Boolean(props.editable)
      const [draft, setDraft] = react.useState({ tokens: '', warn: '', error: '', trigger: '', target: '', strategy: 'balanced', analyticsLimit: '' })
      const [result, setResult] = react.useState({ kind: 'idle' })

      react.useEffect(() => {
        setDraft({
          tokens: budget.tokens === undefined ? '' : String(budget.tokens),
          warn: budget.warnAt === undefined ? '' : String(budget.warnAt),
          error: budget.errorAt === undefined ? '' : String(budget.errorAt),
          trigger: budget.triggerAt === undefined ? '' : String(budget.triggerAt),
          target: budget.targetAt === undefined ? '' : String(budget.targetAt),
          strategy: typeof budget.compressionStrategy === 'string' ? budget.compressionStrategy : 'balanced',
          analyticsLimit: budget.analyticsLimit === undefined ? '40' : String(budget.analyticsLimit),
        })
      }, [budget.tokens, budget.warnAt, budget.errorAt, budget.triggerAt, budget.targetAt, budget.compressionStrategy, budget.analyticsLimit])

      const save = () => {
        const tokens = Number(draft.tokens)
        const warn = Number(draft.warn)
        const error = Number(draft.error)
        const trigger = Number(draft.trigger)
        const target = Number(draft.target)
        const analyticsLimit = Number(draft.analyticsLimit)
        if (!Number.isInteger(analyticsLimit) || analyticsLimit < 1 || analyticsLimit > 200) {
          setResult({ kind: 'error', message: t('invalidAnalyticsLimit') })
          return
        }
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
          body: JSON.stringify({ contextWindowTokens: tokens, warnAt: warn, errorAt: error, triggerAt: trigger, targetAt: target, compressionStrategy: draft.strategy, analyticsLimit }),
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
                  h('span', { style: styles.label }, t('compressionStrategy')),
                ),
                h('select', {
                  style: styles.input,
                  value: draft.strategy,
                  disabled,
                  'data-embodiment-strategy': '1',
                  onChange: (event) => {
                    const strategy = event.target.value
                    const preset = STRATEGY_PRESETS[strategy] || STRATEGY_PRESETS.balanced
                    setDraft({ ...draft, strategy, trigger: String(preset.trigger), target: String(preset.target) })
                  },
                },
                  h('option', { value: 'conservative' }, t('strategyConservative')),
                  h('option', { value: 'balanced' }, t('strategyBalanced')),
                  h('option', { value: 'aggressive' }, t('strategyAggressive')),
                ),
              ),
              h(
                'label',
                { style: styles.field },
                h(
                  'span',
                  { style: styles.fieldLabelRow },
                  h('span', { style: styles.label }, t('analyticsLimitLabel')),
                ),
                h('input', { style: styles.input, type: 'number', min: 1, max: 200, step: 1, value: draft.analyticsLimit, disabled, 'data-embodiment-analytics-limit': '1', onChange: (event) => setDraft({ ...draft, analyticsLimit: event.target.value }) }),
                h('span', { style: styles.fieldUnit }, t('analyticsLimitHint')),
              ),
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
          result.kind === 'saved' ? h('p', { style: styles.successText, 'data-embodiment-config-saved': '1' }, t('saved')) : null,
          result.kind === 'error' ? h('p', { style: styles.error }, result.message) : null,
        ),
      )
    }

    /** 共享面板：设置分区与整页都用它。 */
    // ── 首次运行 / 健康 / 洞察 / 节省 / 数据管理 ───────────────────────────
    function OnboardingCard(props) {
      const t = props.t
      const data = props.data || {}
      const onboarding = data.onboarding || {}
      const budget = data.budget || {}
      const [tokens, setTokens] = react.useState(String(budget.tokens || 128000))
      const [strategy, setStrategy] = react.useState(budget.compressionStrategy || 'balanced')
      const [consent, setConsent] = react.useState(false)
      const [busy, setBusy] = react.useState(false)
      const [error, setError] = react.useState('')
      if (onboarding.completed || onboarding.dismissed) return null
      const post = (path, body) => fetch(`${STATUS_PATH}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
        return payload
      })
      const finish = async (dismiss) => {
        if (dismiss) {
          setBusy(true)
          try {
            // “稍后”不是永久关闭：只记录 deferredAt，下次进入仍会再次出现（见 onboarding 文案）。
            await post('/onboarding', { deferred: true })
            if (typeof props.onDone === 'function') props.onDone()
          } catch (failure) {
            setError(String(failure?.message || failure))
          } finally {
            setBusy(false)
          }
          return
        }
        const number = Number(tokens)
        if (!Number.isInteger(number) || number <= 0) {
          setError(t('onboardingBudgetRequired'))
          return
        }
        setBusy(true)
        setError('')
        try {
          await post('/onboarding', {
            completed: true,
            dismissed: false,
            budgetConfirmed: true,
            budgetTokens: number,
            presetConsent: consent,
          })
          if (consent) {
            try { await post('/config/preset', { enable: true }) } catch {}
          }
          if (number !== Number(budget.tokens) || strategy !== budget.compressionStrategy) {
            const preset = STRATEGY_PRESETS[strategy] || STRATEGY_PRESETS.balanced
            try {
              await post('/config', { contextWindowTokens: number, compressionStrategy: strategy, triggerAt: preset.trigger, targetAt: preset.target })
            } catch {}
          }
          if (typeof props.onDone === 'function') props.onDone()
        } catch (failure) {
          setError(String(failure?.message || failure))
        } finally {
          setBusy(false)
        }
      }
      return h('div', { style: styles.card, 'data-embodiment-onboarding': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('onboardingTitle')), h('span', { style: styles.cardSub }, t('onboardingIntro'))),
        h('div', { style: styles.configGrid },
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('onboardingBudget')),
            h('input', { style: styles.input, type: 'number', min: 1, step: 1000, value: tokens, disabled: busy, onChange: (event) => setTokens(event.target.value), 'data-embodiment-onboarding-budget': '1' }),
            h('span', { style: styles.fieldUnit }, t('onboardingBudgetHint')),
          ),
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('onboardingStrategy')),
            h('select', { style: styles.input, value: strategy, disabled: busy, onChange: (event) => setStrategy(event.target.value), 'data-embodiment-onboarding-strategy': '1' },
              h('option', { value: 'conservative' }, t('strategyConservative')),
              h('option', { value: 'balanced' }, t('strategyBalanced')),
              h('option', { value: 'aggressive' }, t('strategyAggressive')),
            ),
          ),
        ),
        h('div', { style: styles.detailBox },
          h('strong', { style: styles.cardTitle }, t('onboardingPreset')),
          h('p', { style: styles.text }, t('onboardingPresetHint')),
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '12px' } },
            h('input', { type: 'checkbox', checked: consent, disabled: busy, onChange: (event) => setConsent(event.target.checked), 'data-embodiment-onboarding-consent': '1' }),
            h('span', null, t('onboardingPresetYes')),
          ),
        ),
        error ? h('p', { style: styles.error }, error) : null,
        h('div', { style: styles.actionRow },
          h('button', { type: 'button', style: { ...styles.button, ...styles.buttonPrimary }, disabled: busy, onClick: () => finish(false), 'data-embodiment-onboarding-finish': '1' }, busy ? t('saving') : t('onboardingFinish')),
          h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => finish(true), 'data-embodiment-onboarding-later': '1' }, t('onboardingLater')),
        ),
      )
    }

    function OnboardingReopen(props) {
      const t = props.t
      const [busy, setBusy] = react.useState(false)
      const [error, setError] = react.useState('')
      const reopen = () => {
        setBusy(true)
        setError('')
        fetch(`${STATUS_PATH}/onboarding`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reset: true }),
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
            if (typeof props.onDone === 'function') props.onDone()
          })
          .catch((failure) => setError(String(failure?.message || failure)))
          .finally(() => setBusy(false))
      }
      return h('div', { style: styles.banner, 'data-embodiment-onboarding-reopen': '1' },
        h('span', null, t('onboardingReopenHint')),
        h('button', { type: 'button', style: styles.button, disabled: busy, onClick: reopen, 'data-embodiment-onboarding-reopen-btn': '1' }, t('onboardingReopen')),
        error ? h('span', { style: styles.error }, error) : null,
      )
    }

    /**
     * 本会话预算覆盖：面板里的等价入口，省得用户记 `/embody <tokens>` 命令。
     * 写 `/status/session-budget`，tokens 传 null 表示清除（回到控制行/宿主默认）。
     */
    function SessionBudgetCard(props) {
      const t = props.t
      const current = Number(props.current) > 0 ? Number(props.current) : null
      const [value, setValue] = react.useState(() => (current ? String(current) : ''))
      const [busy, setBusy] = react.useState(false)
      const [notice, setNotice] = react.useState(null)
      const sessionId = props.sessionId || ''
      const submit = (tokens) => {
        if (busy || !sessionId) return
        setBusy(true)
        setNotice(null)
        fetchJson(`${STATUS_PATH}/session-budget`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, tokens }),
        })
          .then(() => {
            setNotice({ kind: 'ok', text: t('sessionBudgetSaved') })
            if (typeof props.onDone === 'function') props.onDone()
          })
          .catch((error) => setNotice({ kind: 'error', text: `${t('sessionBudgetFailed')}: ${String((error && error.message) || error)}` }))
          .finally(() => setBusy(false))
      }
      const parsed = Number(value)
      const valid = Number.isInteger(parsed) && parsed > 0
      return h(
        Card,
        { title: t('sessionBudget'), t, style: styles.cardFill, id: 'session-budget' },
        h('p', { style: styles.text }, sessionId ? t('sessionBudgetHint') : t('sessionBudgetNoSession')),
        h(
          'div',
          { style: styles.fieldLabelRow },
          h('input', {
            type: 'number',
            min: 1,
            step: 1000,
            value,
            disabled: busy || !sessionId,
            placeholder: String(props.budget || 128000),
            onChange: (event) => setValue(event.target.value),
            style: styles.input,
            'data-embodiment-session-budget-input': '1',
            'aria-label': t('sessionBudget'),
          }),
          h('button', { type: 'button', style: styles.buttonPrimary, disabled: busy || !sessionId || !valid, onClick: () => submit(parsed), 'data-embodiment-session-budget-save': '1' }, t('save')),
          current ? h('button', { type: 'button', style: styles.button, disabled: busy || !sessionId, onClick: () => submit(null), 'data-embodiment-session-budget-clear': '1' }, t('clear')) : null,
        ),
        current ? h('p', { style: styles.kpiSub }, `${t('sessionBudgetCurrent')}: ${current}`) : null,
        notice ? h('p', { style: notice.kind === 'error' ? styles.error : styles.text }, notice.text) : null,
      )
    }

    function HealthCard(props) {
      const t = props.t
      const health = props.health
      const control = props.control || {}
      const [busy, setBusy] = react.useState(false)
      const [notice, setNotice] = react.useState('')
      if (!health || !Array.isArray(health.checks)) return null
      const labels = {
        control: t('healthControl'),
        preset: t('healthPreset'),
        config: t('healthConfig'),
        budget: t('healthBudget'),
        measurement: t('healthMeasurement'),
      }
      const repair = () => {
        setBusy(true)
        setNotice('')
        fetch(`${STATUS_PATH}/config/preset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enable: true }) })
          .then((response) => response.json().catch(() => ({})).then((payload) => {
            if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
            setNotice(t('healthFixed'))
            if (typeof props.onDone === 'function') setTimeout(props.onDone, 1200)
          }))
          .catch((failure) => setNotice(String(failure?.message || failure)))
          .finally(() => setBusy(false))
      }
      return h('div', { style: styles.card, 'data-embodiment-health': health.healthy ? 'ok' : 'issue' },
        h('div', { style: styles.cardHead },
          h('h3', { style: styles.cardTitle }, t('healthTitle')),
          h(StatusBadge, { t, state: health.healthy ? 'ok' : 'warn', label: health.healthy ? t('healthOk') : t('healthIssue') }),
        ),
        h('ul', { style: styles.checkList }, health.checks.map((check) => h('li', { key: check.id, style: styles.checkItem, 'data-embodiment-health-check': check.id },
          h('span', { style: { color: check.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' } }, check.ok ? '✓' : '!'),
          h('span', null, labels[check.id] || check.id),
        ))),
        !health.healthy && control.presetMountable && !control.presetMounted
          ? h('button', { type: 'button', style: { ...styles.button, ...styles.buttonPrimary }, disabled: busy, onClick: repair, 'data-embodiment-health-fix': '1' }, busy ? t('saving') : t('healthFix'))
          : null,
        !health.healthy && control.presetMounted && !control.active ? h('p', { style: styles.cardSub }, t('healthManual')) : null,
        notice ? h('p', { style: styles.cardSub }, notice) : null,
      )
    }

    function insightText(t, insight) {
      const values = (insight && insight.values) || {}
      const share = formatPercent(values.share, 0)
      const tokens = compactTokens(values.tokens || values.toolsTokens || 0)
      const count = values.count ?? values.sessions ?? 0
      if (insight.id === 'tool-schema-share') return t('insightToolShare').replace('{share}', share).replace('{tokens}', tokens)
      if (insight.id === 'unused-tools') return t('insightUnusedTools').replace('{count}', String(count)).replace('{tokens}', tokens)
      if (insight.id === 'repeated-compaction') return t('insightRepeatedCompaction').replace('{sessions}', String(values.sessions || 0)).replace('{compactions}', String(values.compactions || 0))
      if (insight.id === 'compaction-failures') return t('insightCompactionFailures').replace('{count}', String(count))
      if (insight.id === 'unknown-pricing') return t('insightUnknownPricing').replace('{sessions}', String(values.sessions || 0)).replace('{tokens}', tokens)
      if (insight.id === 'cost-outlier') return t('insightCostOutlier').replace('{title}', values.title || shortSessionId(values.sessionId || '')).replace('{multiple}', (Number(values.multiple) || 0).toFixed(1)).replace('{cost}', formatCost(values.cost))
      return ''
    }

    function InsightCards(props) {
      const t = props.t
      const insights = Array.isArray(props.insights) ? props.insights : []
      if (insights.length === 0) return h('div', { style: styles.card, 'data-embodiment-insights': 'empty' }, h('h3', { style: styles.cardTitle }, t('insightsTitle')), h('p', { style: styles.emptyText }, t('insightsEmpty')))
      return h('div', { style: styles.card, 'data-embodiment-insights': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('insightsTitle')), h('span', { style: styles.cardSub }, String(insights.length))),
        h('ul', { style: styles.insightList }, insights.map((insight) => h('li', { key: insight.id, style: styles.insightItem, 'data-embodiment-insight': insight.id },
          h('span', { style: { ...styles.badge, ...(insight.severity === 'warn' ? styles.badgeWarn : styles.badgeOk) } }, insight.severity === 'warn' ? '!' : 'i'),
          h('span', { style: styles.insightText }, insightText(t, insight)),
          h('button', { type: 'button', style: styles.copyBtn, onClick: () => props.onOpen && props.onOpen(insight.action || {}) }, t('insightOpen')),
        ))),
      )
    }

    function SavingsCard(props) {
      const t = props.t
      const savings = props.savings
      if (!savings || (!savings.compactions && !savings.tokens)) return null
      return h('div', { style: styles.card, 'data-embodiment-savings': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('savingsTitle')), h('span', { style: styles.cardSub }, t('costEstimateLabel'))),
        h('div', { style: styles.kpiBand },
          h('div', { style: styles.kpiCard }, h('span', { style: styles.kpiCardLabel }, t('savingsCompactions')), h('strong', { style: styles.kpiCardValue }, formatTokens(savings.compactions))),
          h('div', { style: { ...styles.kpiCard, ...styles.kpiCardDivider } }, h('span', { style: styles.kpiCardLabel }, t('savingsTokens')), h('strong', { style: styles.kpiCardValue }, compactTokens(savings.tokens))),
          h('div', { style: { ...styles.kpiCard, ...styles.kpiCardDivider } }, h('span', { style: styles.kpiCardLabel }, t('savingsCost')), h('strong', { style: styles.kpiCardValue }, formatCost(savings.estimatedCost))),
        ),
        h('p', { style: styles.billingNote }, t('savingsMethod')),
      )
    }

    function AlertStrip(props) {
      const t = props.t
      const live = props.live || {}
      const control = props.control || {}
      const alerts = []
      if (!control.active) alerts.push({ id: 'control', text: t('alertControlMissing') })
      const ratio = typeof live.ratio === 'number' ? live.ratio : null
      const warnAt = typeof live.warnAt === 'number' ? live.warnAt : 0.75
      const errorAt = typeof live.errorAt === 'number' ? live.errorAt : 0.9
      if (ratio !== null && ratio >= errorAt) alerts.push({ id: 'budget-error', text: t('alertBudgetError').replace('{percent}', formatPercent(ratio, 0)) })
      else if (ratio !== null && ratio >= warnAt) alerts.push({ id: 'budget-warn', text: t('alertBudgetWarn').replace('{percent}', formatPercent(ratio, 0)) })
      const failure = Array.isArray(control.log) ? control.log.slice().reverse().find((entry) => entry && entry.outcome === 'failure') : null
      if (failure) alerts.push({ id: 'compaction', text: t('alertCompactionFailed') })
      if (alerts.length === 0) return null
      return h('div', { style: styles.alertStrip, 'data-embodiment-alert': alerts.map((alert) => alert.id).join(',') },
        alerts.map((alert) => h('div', { key: alert.id, style: styles.alertRow },
          h('span', { style: styles.alertDot }),
          h('span', null, alert.text),
          alert.id === 'control' ? h('button', { type: 'button', style: styles.copyBtn, onClick: () => props.onOpen && props.onOpen('settings') }, t('healthFix')) : null,
        )),
      )
    }

    function SessionCompare(props) {
      const t = props.t
      const sessions = Array.isArray(props.sessions) ? props.sessions : []
      const ranked = sessions.slice().sort((left, right) => (right.tokens || 0) - (left.tokens || 0))
      const [leftId, setLeftId] = react.useState(ranked[0]?.id || '')
      const [rightId, setRightId] = react.useState(ranked[1]?.id || '')
      if (sessions.length < 2) return null
      const left = sessions.find((session) => session.id === leftId) || ranked[0]
      const right = sessions.find((session) => session.id === rightId) || ranked[1]
      const select = (value, onChange) => h('select', { style: styles.input, value, onChange: (event) => onChange(event.target.value), 'data-embodiment-compare-select': '1' },
        sessions.map((session) => h('option', { key: session.id, value: session.id }, `${session.title || shortSessionId(session.id)} · ${compactTokens(session.tokens)}`)),
      )
      const rows = [
        ['compareTokens', (session) => compactTokens(session.tokens)],
        ['compareRequests', (session) => formatTokens(session.requests)],
        ['compareCost', (session) => formatCost(session.cost)],
        ['compareCompactions', (session) => formatTokens(session.compactions)],
      ]
      return h('div', { style: styles.card, 'data-embodiment-compare': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('compareTitle')), h('span', { style: styles.cardSub }, t('compareEmpty'))),
        h('div', { style: styles.compareGrid },
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('compareA')), select(left.id, setLeftId)),
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('compareB')), select(right.id, setRightId)),
        ),
        h('div', { style: styles.compareRows }, rows.map(([key, read]) => h('div', { key, style: styles.compareRow },
          h('span', { style: styles.billingRowLabel }, t(key)),
          h('span', { style: styles.compareValue }, read(left)),
          h('span', { style: styles.compareValue }, read(right)),
        ))),
      )
    }

    function PricingSection(props) {
      const t = props.t
      const pricing = props.pricing || {}
      const editable = Boolean(props.editable)
      const [rows, setRows] = react.useState([])
      const [busy, setBusy] = react.useState(false)
      const [notice, setNotice] = react.useState('')
      react.useEffect(() => {
        const incoming = Array.isArray(pricing.rows) ? pricing.rows : []
        setRows(incoming.map((row) => ({
          match: String(row.match || ''),
          input: String(row.input ?? ''),
          cacheRead: String(row.cacheRead ?? ''),
          cacheWrite: String(row.cacheWrite ?? ''),
          output: String(row.output ?? ''),
        })))
      }, [pricing.rows])
      const update = (index, key, value) => setRows((current) => current.map((row, at) => at === index ? { ...row, [key]: value } : row))
      const save = () => {
        setBusy(true)
        setNotice('')
        const payload = rows
          .filter((row) => row.match.trim().length > 0)
          .map((row) => ({
            match: row.match.trim(),
            input: Number(row.input) || 0,
            cacheRead: Number(row.cacheRead) || 0,
            cacheWrite: Number(row.cacheWrite) || 0,
            output: Number(row.output) || 0,
          }))
        fetch(`${STATUS_PATH}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelPricing: payload }) })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (response.status !== 202) throw new Error(data.error || `HTTP ${response.status}`)
            setNotice(t('pricingSaved'))
            if (typeof props.onSaved === 'function') setTimeout(props.onSaved, 1200)
          })
          .catch((failure) => setNotice(String(failure?.message || failure)))
          .finally(() => setBusy(false))
      }
      const cell = (row, index, key, label) => h('input', {
        style: styles.input,
        value: row[key],
        placeholder: label,
        disabled: !editable || busy,
        onChange: (event) => update(index, key, event.target.value),
        'data-embodiment-pricing-field': key,
      })
      return h('div', { style: styles.card, 'data-embodiment-pricing': '1', 'data-embodiment-card': 'pricing' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('pricingTitle')), h('span', { style: styles.cardSub }, t('costCustom'))),
        h('p', { style: styles.text }, t('pricingHint')),
        rows.length === 0 ? h('p', { style: styles.emptyText }, t('pricingEmpty')) : h('div', { style: styles.pricingRows },
          rows.map((row, index) => h('div', { key: index, style: styles.pricingRow },
            cell(row, index, 'match', t('pricingMatch')),
            cell(row, index, 'input', t('pricingInput')),
            cell(row, index, 'cacheRead', t('pricingCacheRead')),
            cell(row, index, 'cacheWrite', t('pricingCacheWrite')),
            cell(row, index, 'output', t('pricingOutput')),
            h('button', { type: 'button', style: styles.copyBtn, disabled: busy, onClick: () => setRows((current) => current.filter((_, at) => at !== index)) }, t('pricingRemove')),
          )),
        ),
        h('div', { style: styles.actionRow },
          h('button', { type: 'button', style: styles.button, disabled: !editable || busy, onClick: () => setRows((current) => [...current, { match: '', input: '', cacheRead: '', cacheWrite: '', output: '' }]), 'data-embodiment-pricing-add': '1' }, t('pricingAdd')),
          h('button', { type: 'button', style: styles.button, disabled: !editable || busy, onClick: save, 'data-embodiment-pricing-save': '1' }, busy ? t('saving') : t('pricingSave')),
          notice ? h('span', { style: styles.cardSub }, notice) : null,
        ),
      )
    }

    function DataCard(props) {
      const t = props.t
      const range = props.range || '7d'
      const coverage = props.coverage || {}
      const [confirm, setConfirm] = react.useState('')
      const [exportConfirm, setExportConfirm] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [notice, setNotice] = react.useState('')
      // 二次确认通过后再真正触发下载：用临时 <a download> 保留文件名与浏览器原生下载行为。
      const downloadExport = (format) => {
        try {
          const link = document.createElement('a')
          link.href = `${STATUS_PATH}/export?format=${encodeURIComponent(format)}&range=${encodeURIComponent(range)}`
          link.download = ''
          link.rel = 'noopener'
          document.body.appendChild(link)
          link.click()
          link.remove()
        } catch {}
        setExportConfirm('')
      }
      const clear = (scope) => {
        if (confirm !== scope) {
          setConfirm(scope)
          return
        }
        setBusy(true)
        fetch(`${STATUS_PATH}/data/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope }) })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
            setNotice(t('cleared'))
            setConfirm('')
            if (typeof props.onDone === 'function') props.onDone()
          })
          .catch((failure) => setNotice(String(failure?.message || failure)))
          .finally(() => setBusy(false))
      }
      return h('div', { style: styles.card, 'data-embodiment-data': '1' },
        h('div', { style: styles.cardHead }, h('h3', { style: styles.cardTitle }, t('clearData')), h('span', { style: styles.cardSub }, t('dataScope').replace('{scanned}', String(coverage.scanned ?? '—')).replace('{total}', String(coverage.total ?? '—')).replace('{limit}', String(coverage.limit ?? '—')))),
        h('p', { style: styles.text }, t('clearDataHint')),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', margin: '2px 0 6px' }, title: t('alertToggleHint') },
          h('input', {
            type: 'checkbox',
            checked: props.alertsEnabled !== false,
            'data-embodiment-alerts-toggle': '1',
            onChange: (event) => { if (typeof props.onAlertsChange === 'function') props.onAlertsChange(event.target.checked) },
          }),
          h('span', null, t('alertToggle')),
        ),
        h('p', { style: styles.cardSub }, t('alertToggleHint')),
        h('div', { style: styles.actionRow },
          h('button', { type: 'button', style: styles.button, onClick: () => setExportConfirm('json'), 'data-embodiment-export': 'json' }, t('exportJson')),
          h('button', { type: 'button', style: styles.button, onClick: () => setExportConfirm('csv'), 'data-embodiment-export': 'csv' }, t('exportCsv')),
        ),
        // 导出文件里含本机绝对路径（cwd），下载前先确认一次，避免误点外传。
        exportConfirm
          ? h('div', { style: styles.actionRow, 'data-embodiment-export-confirm': exportConfirm },
              h('span', { style: styles.cardSub }, t('exportConfirmHint')),
              h('button', { type: 'button', style: styles.buttonPrimary, onClick: () => downloadExport(exportConfirm), 'data-embodiment-export-yes': '1' }, t('exportConfirmYes')),
              h('button', { type: 'button', style: styles.button, onClick: () => setExportConfirm(''), 'data-embodiment-export-cancel': '1' }, t('cancel')),
            )
          : null,
        h('div', { style: styles.actionRow },
          ['logs', 'toggles', 'all'].map((scope) => h('button', { key: scope, type: 'button', style: styles.button, disabled: busy, onClick: () => clear(scope), 'data-embodiment-data-clear': scope }, scope === 'logs' ? t('clearLogs') : scope === 'toggles' ? t('clearToggles') : t('clearAllData'))),
        ),
        confirm ? h('p', { style: styles.error }, t('clearDataConfirm')) : null,
        notice ? h('p', { style: styles.cardSub }, notice) : null,
      )
    }

    function LabsCard(props) {
      const t = props.t
      const [open, setOpen] = react.useState(false)
      return h('div', { style: styles.card, 'data-embodiment-labs': '1' },
        h('div', { style: styles.cardHead },
          h('h3', { style: styles.cardTitle }, t('labsTitle')),
          h('button', { type: 'button', style: styles.copyBtn, onClick: () => setOpen(!open), 'data-embodiment-labs-toggle': '1' }, open ? t('collapse') : t('expand')),
        ),
        h('p', { style: styles.text }, t('labsHint')),
        open ? h(ScaffoldPanel, { t }) : null,
      )
    }

    /** 共享面板：设置分区与整页都用它。 */

    // ── 会话洞察：KPI / 每日图 / 会话卡 / 趋势 / 事件 ───────────────────────
