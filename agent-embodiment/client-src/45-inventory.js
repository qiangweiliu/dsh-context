    function InventoryCard(props) {
      const t = props.t
      const data = props.data || {}
      const sources = (data.inventory && data.inventory.sources) || {}
      const sourceOf = (name) => (sources.sections && sources.sections[name]) || null
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
      const [extraDraft, setExtraDraft] = react.useState(null)
      const [extraBusy, setExtraBusy] = react.useState(false)
      const [extraDeletePending, setExtraDeletePending] = react.useState(null)
      const [restorePending, setRestorePending] = react.useState(false)
      const [localEdits, setLocalEdits] = react.useState({})
      const [notice, setNotice] = react.useState(null)
      const activeId = props.sessionId || data.sessionId || null

      // 会话切换时丢弃上一会话的草稿/展开/确认态，避免把 A 会话的编辑带到 B 会话。
      react.useEffect(() => {
        setExpanded({})
        setCopied(null)
        setPending(null)
        setBusy(null)
        setEditDraft(null)
        setPromptSave(null)
        setExtraDraft(null)
        setExtraDeletePending(null)
        setRestorePending(false)
        setLocalEdits({})
        setNotice(null)
      }, [activeId])

      const controlReady = props.controlActive !== false
      const requireControl = () => {
        if (controlReady) return true
        setNotice(t('controlRequired'))
        return false
      }

      // 全局 postJson 已按非 2xx 抛出服务端 error；这里再兜一层 `{ ok: false }`（旧接口约定）。
      const requireOk = (payload) => {
        if (payload && payload.ok === false) throw new Error(payload.error || t('saveFailed'))
        return payload || {}
      }
      const promptFailure = (failure) => setNotice(`${t('saveFailed')}: ${String((failure && failure.message) || failure)}`)

      const post = (body) => {
        if (!requireControl()) return
        setBusy(body)
        postJson(`${STATUS_PATH}/inventory/toggle`, body)
          .then((payload) => payload || {})
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
        if (!requireControl()) return
        postJson(`${STATUS_PATH}/inventory/reset`, { layer: 'all' })
          .then(requireOk)
          .then(() => {
            setRestorePending(false)
            setNotice(null)
            setTimeout(() => props.reload && props.reload(), 1800)
          })
          .catch((failure) => {
            setRestorePending(false)
            promptFailure(failure)
          })
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
        if (!requireControl()) return
        setPromptBusy(true)
        postJson(`${STATUS_PATH}/inventory/prompt${suffix}`, body)
          .then(requireOk)
          .then(() => {
            setPromptBusy(false)
            setEditDraft(null)
            setPromptSave(null)
            if (suffix === '') { setLocalEdits((prev) => ({ ...prev, [body.name]: body.text })); setNotice(t('savedGlobal')) }
            else if (body && typeof body.name === 'string') setLocalEdits((prev) => { const next = { ...prev }; delete next[body.name]; return next })
            else setLocalEdits({})
            setTimeout(() => props.reload && props.reload(), 1200)
          })
          .catch((failure) => {
            setPromptBusy(false)
            promptFailure(failure)
          })
      }

      const postSessionPrompt = (name, text) => {
        if (!requireControl()) return
        setPromptBusy(true)
        postJson(`${STATUS_PATH}/inventory/prompt/session`, { name, text, ...(props.sessionId ? { sessionId: props.sessionId } : {}) })
          .then(requireOk)
          .then(() => {
            setPromptBusy(false)
            setEditDraft(null)
            setPromptSave(null)
            setLocalEdits((prev) => ({ ...prev, [name]: text }))
            setNotice(t('savedSession'))
            setTimeout(() => props.reload && props.reload(), 800)
          })
          .catch((failure) => {
            setPromptBusy(false)
            promptFailure(failure)
          })
      }

      const postSessionPromptReset = (name) => {
        if (!requireControl()) return
        setPromptBusy(true)
        postJson(`${STATUS_PATH}/inventory/prompt/session/reset`, { name, ...(props.sessionId ? { sessionId: props.sessionId } : {}) })
          .then(requireOk)
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
          .catch((failure) => {
            setPromptBusy(false)
            promptFailure(failure)
          })
      }

      const postExtraPrompt = (name, text, placement = 'system') => {
        if (!requireControl()) return
        setExtraBusy(true)
        postJson(`${STATUS_PATH}/inventory/extra-prompt`, { name, text, placement })
          .then(requireOk)
          .then((payload) => {
            setExtraBusy(false)
            if (!payload || !payload.ok) {
              setNotice((payload && payload.error) || t('inventoryLoadFailed'))
              return
            }
            setExtraDraft(null)
            setPromptSave(null)
            setEditDraft(null)
            setNotice(t('extraPromptSaved'))
            setTimeout(() => props.reload && props.reload(), 900)
          })
          .catch((failure) => {
            setExtraBusy(false)
            promptFailure(failure)
          })
      }

      const postExtraPromptReset = (name) => {
        setExtraBusy(true)
        postJson(`${STATUS_PATH}/inventory/extra-prompt/reset`, { name })
          .then(requireOk)
          .then(() => {
            setExtraBusy(false)
            setExtraDeletePending(null)
            setNotice(null)
            setTimeout(() => props.reload && props.reload(), 900)
          })
          .catch((failure) => {
            setExtraBusy(false)
            promptFailure(failure)
          })
      }

      const switchNode = (kind, name, layer, enabled) => {
        const key = `${kind}:${name}:${layer}`
        const confirming = pending && pending.kind === kind && pending.name === name && pending.layer === layer
        const working = busy && busy.kind === kind && busy.name === name && busy.layer === layer
        if (confirming) {
          return h(
            'span',
            { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } },
            h('button', { type: 'button', style: styles.copyBtn, onClick: confirm, 'data-embodiment-confirm': '1' }, t('confirm')),
            h('button', { type: 'button', style: styles.copyBtn, onClick: () => setPending(null) }, t('cancel')),
          )
        }
        return h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled,
            'data-embodiment-switch': key,
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
          h('pre', { style: styles.pre, 'data-embodiment-detail': key }, text),
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
      const extraPrompts = data.extraPrompts && typeof data.extraPrompts === 'object' ? data.extraPrompts : {}
      const extraPromptPlacements = data.extraPromptPlacements && typeof data.extraPromptPlacements === 'object' ? data.extraPromptPlacements : {}
      for (const [name, text] of Object.entries(extraPrompts)) {
        const sectionName = name.startsWith('agent-embodiment:extra:') ? name : `agent-embodiment:extra:${name}`
        const placement = extraPromptPlacements[name] === 'user' ? 'user' : 'system'
        const existing = sections.find((section) => section.name === sectionName)
        if (existing) {
          existing.extra = true
          existing.extraName = name
          existing.extraPlacement = placement
        } else {
          sections.push({
            name: sectionName,
            extraName: name,
            extra: true,
            extraPlacement: placement,
            tokens: Math.ceil(String(text).length / 4),
            text: String(text),
            originalText: String(text),
            overridden: true,
            globalOverridden: true,
          })
        }
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
        const toolOff = !enabledToolName(tool.name)
        return h(
          'li',
          { key, style: styles.inventoryItem },
          h(
            'div',
            { style: styles.inventoryRow },
            h(
              'button',
              { type: 'button', style: styles.inventoryHead, 'data-embodiment-expand': key, 'aria-expanded': isOpen, onClick: () => setExpanded({ ...expanded, [key]: !isOpen }) },
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
          toolOff
            ? h('p', { style: styles.cardSub, 'data-embodiment-tool-disabled-impact': tool.name, title: t('toolDisableWarning') },
                tool.tokens !== null && tool.tokens !== undefined
                  ? t('toolDisabledImpact').replace('{tokens}', compactTokens(tool.tokens))
                  : t('toolDisabledImpactUnknown'))
            : null,
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
                      h('pre', { style: styles.pre, 'data-embodiment-schema': key }, schemaText),
                    )
                  : null,
              )
            : null,
        )
      }

      const promptRow = (section) => {
        const key = `prompt:${section.name}`
        const isExtra = Boolean(section.extra)
        const displayName = isExtra ? (section.extraName || section.name) : section.name
        const extraPlacement = section.extraPlacement === 'user' ? 'user' : 'system'
        const extraBadge = extraPlacement === 'user' ? t('extraPromptUserBadge') : t('extraPromptSystemBadge')
        const isOpen = Boolean(expanded[key])
        const editing = editDraft && editDraft.name === section.name
        const hasLocal = Object.prototype.hasOwnProperty.call(localEdits, section.name)
        const effectiveText = hasLocal ? localEdits[section.name] : section.text || ''
        const dirty = isExtra || hasLocal || section.overridden || (section.originalText !== undefined && section.originalText !== section.text)
        const unchanged = !editDraft || editDraft.text === effectiveText
        const editorNode = editing
          ? h('textarea', {
              style: styles.promptEditor,
              rows: 8,
              value: editDraft.text,
              'data-embodiment-prompt-editor': section.name,
              onChange: (event) => setEditDraft({ ...editDraft, text: event.target.value }),
            })
          : h('div', { style: styles.detailBox },              h('div', { style: styles.detailHead },
                h('span', { style: styles.cardSub }, isExtra ? `${t('extraLabel')} · ${extraBadge}` : dirty ? (section.sessionOverridden ? t('sessionOverridden') : t('globalOverridden')) : t('editHint')),
                h('span', { style: { ...styles.cardSub, fontFamily: 'ui-monospace, monospace', maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: sourceOf(section.name) || t('sourceUnknown') }, `${t('source')}: ${sourceOf(section.name) || t('sourceUnknown')}`),
                h('span', { style: { display: 'inline-flex', gap: '6px' } },
                  h('button', { type: 'button', style: styles.copyBtn, 'data-embodiment-prompt-edit': section.name, onClick: () => { setEditDraft({ name: section.name, text: effectiveText }); setPromptSave(null) }, disabled: promptBusy || extraBusy }, t('edit')),
                  isExtra
                    ? extraDeletePending === section.name
                      ? [
                          h('button', { key: 'del', type: 'button', style: styles.copyBtn, 'data-embodiment-extra-delete-confirm': section.name, onClick: () => postExtraPromptReset(displayName), disabled: extraBusy }, t('confirm')),
                          h('button', { key: 'no', type: 'button', style: styles.copyBtn, onClick: () => setExtraDeletePending(null) }, t('cancel')),
                        ]
                      : [
                          h('button', { key: 'placement', type: 'button', style: styles.copyBtn, 'data-embodiment-extra-placement-toggle': section.name, onClick: () => postExtraPrompt(displayName, effectiveText, extraPlacement === 'user' ? 'system' : 'user'), disabled: extraBusy }, extraPlacement === 'user' ? t('extraPromptSwitchSystem') : t('extraPromptSwitchUser')),
                          h('button', { key: 'delete', type: 'button', style: styles.copyBtn, 'data-embodiment-extra-delete': section.name, onClick: () => setExtraDeletePending(section.name), disabled: extraBusy }, t('extraPromptDelete')),
                        ]
                    : dirty
                      ? h('button', { type: 'button', style: styles.copyBtn, 'data-embodiment-prompt-reset': section.name, onClick: () => (section.sessionOverridden ? postSessionPromptReset(section.name) : postPrompt('/reset', { name: section.name })), disabled: promptBusy }, section.sessionOverridden ? t('resetSession') : t('resetOriginal'))
                      : null,
                  h('button', { type: 'button', style: styles.copyBtn, onClick: () => copy(key, effectiveText) }, copied === key ? t('copied') : t('copy')),
                ),
              ),
              h('pre', { style: styles.pre, 'data-embodiment-detail': key }, effectiveText),
            )
        const diffNode = editing
          ? (() => {
              const diff = promptDiff(effectiveText, editDraft.text)
              if (diff.rows.length === 0) return h('p', { style: styles.cardSub, 'data-embodiment-prompt-diff-empty': '1' }, t('diffNoChange'))
              return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                h('span', { style: styles.cardSub, 'data-embodiment-prompt-diff': section.name }, t('diffDelta').replace('{delta}', diff.deltaTokens > 0 ? `+${diff.deltaTokens}` : String(diff.deltaTokens))),
                h('div', { style: styles.diffBox },
                  ...diff.rows.map((row, index) => h('span', { key: index, style: row.kind === 'remove' ? styles.diffRemove : styles.diffAdd }, `${row.kind === 'remove' ? '-' : '+'} ${row.text}`)),
                ),
              )
            })()
          : null
        return h(
          'li',
          { key, style: styles.inventoryItem },
          h(
            'div',
            { style: styles.inventoryRow },
            h(
              'button',
              { type: 'button', style: styles.inventoryHead, 'data-embodiment-expand': key, 'aria-expanded': isOpen, onClick: () => setExpanded({ ...expanded, [key]: !isOpen }) },
              chevron(isOpen),
              h('span', { style: styles.inventoryName }, displayName),
              isExtra ? h('span', { style: styles.cardSub }, `${t('extraLabel')} · ${extraBadge}`) : dirty ? h('span', { style: styles.cardSub }, section.sessionOverridden ? t('sessionOverridden') : t('globalOverridden')) : null,
              section.tokens !== null && section.tokens !== undefined ? h('span', { style: styles.cardSub }, `~${compactTokens(section.tokens)} ${t('tokensShort')}`) : null,
            ),
            h(
              'span',
              { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', flex: 'none' } },
              h('span', { style: styles.cardSub }, t('sessionSwitch')), switchNode('prompt', section.name, 'session', !disabledSessionPrompts.includes(section.name)),
            ),
          ),
          isOpen ? editorNode : null,
          isOpen && editing ? diffNode : null,
          isOpen && editing
            ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                isExtra
                  ? [h('button', { key: 'save', type: 'button', style: styles.copyBtn, 'data-embodiment-extra-save': section.name, onClick: () => postExtraPrompt(displayName, editDraft.text, extraPlacement), disabled: extraBusy || unchanged }, t('save')),
                     h('button', { key: 'cancel', type: 'button', style: styles.copyBtn, onClick: () => { setEditDraft(null); setPromptSave(null) } }, t('cancel')),
                     h('span', { key: 'hint', style: styles.cardSub }, t('editHint'))]
                  : promptSave === section.name
                    ? [h('span', { key: 'q', style: styles.cardSub }, t('confirmGlobal')),
                       h('button', { key: 'ok', type: 'button', style: styles.copyBtn, 'data-embodiment-prompt-confirm': section.name, onClick: () => postPrompt('', { name: section.name, text: editDraft.text }), disabled: promptBusy || unchanged }, t('confirm')),
                       h('button', { key: 'no', type: 'button', style: styles.copyBtn, onClick: () => setPromptSave(null) }, t('cancel'))]
                    : [h('button', { key: 'session', type: 'button', style: styles.copyBtn, 'data-embodiment-prompt-save-session': section.name, onClick: () => postSessionPrompt(section.name, editDraft.text), disabled: promptBusy || unchanged }, t('saveSession')),
                       h('button', { key: 'save', type: 'button', style: styles.copyBtn, 'data-embodiment-prompt-save': section.name, onClick: () => setPromptSave(section.name), disabled: promptBusy || unchanged }, t('saveGlobal')),
                       h('button', { key: 'cancel', type: 'button', style: styles.copyBtn, onClick: () => { setEditDraft(null); setPromptSave(null) } }, t('cancel')),
                       h('span', { key: 'hint', style: styles.cardSub }, t('editHint'))],
              )
            : null,
        )
      }

      const templateRow = (() => {
        const templates = Array.isArray(data.promptTemplates) ? data.promptTemplates : []
        if (templates.length === 0) return null
        return h(
          'div',
          { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: styles.cardSub }, t('extraPromptTemplates')),
          ...templates.map((template) => h('button', {
            key: template.id,
            type: 'button',
            style: styles.copyBtn,
            'data-embodiment-extra-template': template.id,
            onClick: () => setExtraDraft({
              ...extraDraft,
              name: template.id === 'method' ? t('extraPromptTemplateMethodName') : template.id,
              text: template.text,
              placement: 'system',
            }),
          }, template.id === 'method' ? t('extraPromptTemplateMethod') : template.id)),
        )
      })()

      const extraForm = extraDraft
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 0' } },
            templateRow,
            h('input', {
              type: 'text',
              value: extraDraft.name,
              placeholder: t('extraPromptName'),
              'data-embodiment-extra-name': '1',
              style: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'inherit', font: 'inherit' },
              onChange: (event) => setExtraDraft({ ...extraDraft, name: event.target.value }),
            }),
            h('textarea', {
              rows: 6,
              value: extraDraft.text,
              placeholder: t('extraPromptText'),
              'data-embodiment-extra-text': '1',
              style: { ...styles.promptEditor, minHeight: '96px' },
              onChange: (event) => setExtraDraft({ ...extraDraft, text: event.target.value }),
            }),
            h('label', { style: { ...styles.cardSub, display: 'flex', gap: '6px', alignItems: 'center' } },
              t('extraPromptPlacement'),
              h('select', {
                value: extraDraft.placement || 'user',
                'data-embodiment-extra-placement': '1',
                style: { padding: '5px 7px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'inherit', font: 'inherit' },
                onChange: (event) => setExtraDraft({ ...extraDraft, placement: event.target.value }),
              },
                h('option', { value: 'user' }, t('extraPromptUser')),
                h('option', { value: 'system' }, t('extraPromptSystem')),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                style: styles.copyBtn,
                'data-embodiment-extra-save-new': '1',
                disabled: extraBusy || extraDraft.name.trim().length === 0 || extraDraft.text.trim().length === 0,
                onClick: () => postExtraPrompt(extraDraft.name.trim(), extraDraft.text, extraDraft.placement || 'user'),
              }, t('extraPromptSave')),
              h('button', { type: 'button', style: styles.copyBtn, onClick: () => setExtraDraft(null) }, t('cancel')),
              h('span', { style: styles.cardSub }, t('extraPromptHint')),
            ),
          )
        : h('button', {
            type: 'button',
            style: styles.button,
            'data-embodiment-extra-add': '1',
            onClick: () => setExtraDraft({ name: '', text: '', placement: 'user' }),
          }, t('extraPromptAdd'))

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
            { style: styles.skeletonStack, 'data-embodiment-inventory-loading': '1' },
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
            { style: styles.emptyState, 'data-embodiment-inventory-error': '1' },
            h('p', { style: styles.error }, `${t('inventoryLoadFailed')}: ${loadError}`),
            refreshButton,
          ),
        )
      }
      return h(
        Card,
        { title: t('inventoryTitle'), sub: data.sessionId ? shortSessionId(data.sessionId) : undefined, id: 'inventory', t },
        !controlReady
          ? h('div', { style: styles.banner, 'data-embodiment-control-required': '1' }, t('controlRequired'))
          : null,
        empty
          ? h(
              'div',
              { style: styles.emptyState, 'data-embodiment-inventory-empty': '1' },
              h('p', { style: styles.emptyText }, t('inventoryEmpty')),
              h('div', { style: { display: 'flex', justifyContent: 'center', padding: '2px 0' } }, extraForm),
              notice ? h('p', { style: styles.cardSub, 'data-embodiment-prompt-notice': '1' }, notice) : null,
              refreshButton,
            )
          : null,
        !empty
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              !controlReady
                ? h('div', { style: styles.banner, 'data-embodiment-control-required': '1' }, t('controlRequired'))
                : null,
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
                    'data-embodiment-only-enabled': String(onlyEnabled),
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
                  { type: 'button', style: styles.sectionHead, 'data-embodiment-section': 'tools', onClick: () => setOpen({ ...open, tools: !open.tools }) },
                  chevron(open.tools), t('inventoryTools'), h('span', { style: styles.cardSub }, onlyEnabled ? `${visibleTools.length}/${tools.length}` : String(tools.length)),
                ),
                open.tools ? (visibleTools.length === 0 ? h('p', { style: styles.emptyText }, t('noneEnabled')) : h('ul', { style: styles.inventoryList }, visibleTools.map(toolRow))) : null,
              ),
              h(
                'div',
                { style: styles.inventorySection },
                h(
                  'button',
                  { type: 'button', style: styles.sectionHead, 'data-embodiment-section': 'prompts', onClick: () => setOpen({ ...open, prompts: !open.prompts }) },
                  chevron(open.prompts), t('inventoryPrompts'), h('span', { style: styles.cardSub }, onlyEnabled ? `${visibleSections.length}/${sections.length}` : String(sections.length)),
                ),
                open.prompts ? extraForm : null,
                open.prompts && notice ? h('p', { style: styles.cardSub, 'data-embodiment-prompt-notice': '1' }, notice) : null,
                open.prompts ? (visibleSections.length === 0 ? h('p', { style: styles.emptyText }, t('noneEnabled')) : h('ul', { style: styles.inventoryList }, visibleSections.map(promptRow))) : null,
              ),
              h('p', { style: styles.text }, t('inventoryRisk')),
              restorePending
                ? h(
                    'div',
                    { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                    h('span', { style: styles.cardSub }, t('restoreConfirm')),
                    h('button', { type: 'button', style: styles.button, 'data-embodiment-restore-confirm': '1', onClick: restore }, t('confirm')),
                    h('button', { type: 'button', style: styles.button, onClick: () => setRestorePending(false) }, t('cancel')),
                  )
                : h('button', { type: 'button', style: styles.button, 'data-embodiment-restore-all': '1', onClick: () => setRestorePending(true) }, t('restoreAll')),
            )
          : null,
      )
    }

