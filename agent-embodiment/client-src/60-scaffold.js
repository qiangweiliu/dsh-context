    function ScaffoldPanel(props) {
      const t = props.t
      const sub = { margin: '6px 0 0', fontSize: '11.5px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' }
      const [templateState] = useStatus(`${STATUS_PATH}/scaffold/templates`)
      const templates = templateState.phase === 'ready' && Array.isArray(templateState.data?.templates) ? templateState.data.templates : []
      const [templateId, setTemplateId] = react.useState('')
      const [targetDir, setTargetDir] = react.useState('')
      const [name, setName] = react.useState('')
      const [slug, setSlug] = react.useState('')
      const [overwrite, setOverwrite] = react.useState(false)
      const [writeAgents, setWriteAgents] = react.useState(false)
      const [processSkills, setProcessSkills] = react.useState(false)
      const [mcpJson, setMcpJson] = react.useState('')
      const [plan, setPlan] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [error, setError] = react.useState('')
      const [generated, setGenerated] = react.useState(false)
      const [copied, setCopied] = react.useState(false)

      react.useEffect(() => {
        if (!templateId && templates.length > 0) setTemplateId(templates[0].id)
      }, [templates, templateId])

      const payload = () => {
        let mcp
        if (mcpJson.trim()) {
          try {
            mcp = JSON.parse(mcpJson)
          } catch {
            throw new Error(t('scaffoldMcpInvalid'))
          }
        }
        return {
          template: templateId,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          targetDir,
          ...(overwrite ? { overwrite: true } : {}),
          ...(writeAgents ? { writeAgents: true } : {}),
          ...(processSkills ? { processSkills: true } : {}),
          ...(mcp === undefined ? {} : { mcp }),
        }
      }
      const post = async (path, body) => {
        const response = await fetch(`${STATUS_PATH}/scaffold/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        return data
      }
      const preview = async () => {
        setBusy(true)
        setError('')
        setGenerated(false)
        try {
          setPlan(await post('preview', payload()))
        } catch (failure) {
          setError(String(failure?.message || failure))
        } finally {
          setBusy(false)
        }
      }
      const generate = async () => {
        if (!targetDir.trim()) {
          setError(t('scaffoldTargetRequired'))
          return
        }
        setBusy(true)
        setError('')
        setGenerated(false)
        try {
          const data = await post('generate', payload())
          setPlan({ ...data, files: (data.files || []).map((path) => ({ path })) })
          setGenerated(true)
        } catch (failure) {
          setError(String(failure?.message || failure))
        } finally {
          setBusy(false)
        }
      }
      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {}
      }

      const files = plan && Array.isArray(plan.files) ? plan.files : []
      const warnings = plan && Array.isArray(plan.warnings) ? plan.warnings : []
      const selectedTemplate = templates.find((item) => item.id === templateId)

      return h('div', { style: styles.card, 'data-embodiment-scaffold': '1' },
        h('h3', { style: styles.cardTitle }, t('scaffoldTitle')),
        h('p', { style: sub }, t('scaffoldIntro')),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px', marginTop: '10px' } },
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('scaffoldTemplate')),
            h('select', { style: styles.input, value: templateId, onChange: (event) => setTemplateId(event.target.value), 'data-embodiment-scaffold-template': '1' },
              templates.map((item) => h('option', { key: item.id, value: item.id }, `${item.name} (${item.id})${item.experimental ? ' · experimental' : ''}`)),
            ),
          ),
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('scaffoldSlug')),
            h('input', { style: styles.input, value: slug, placeholder: 'my-agent', onChange: (event) => setSlug(event.target.value), 'data-embodiment-scaffold-slug': '1' }),
          ),
          h('label', { style: styles.field }, h('span', { style: styles.label }, t('scaffoldName')),
            h('input', { style: styles.input, value: name, placeholder: selectedTemplate ? selectedTemplate.name : '', onChange: (event) => setName(event.target.value) }),
          ),
          h('label', { style: styles.field }, h('span', { style: styles.label, title: t('scaffoldTargetHint') }, t('scaffoldTarget')),
            h('input', { style: styles.input, value: targetDir, placeholder: '/absolute/path/to/workspace', onChange: (event) => setTargetDir(event.target.value), 'data-embodiment-scaffold-target': '1' }),
          ),
        ),
        h('p', { style: sub }, t('scaffoldTargetHint')),
        h('label', { style: { ...styles.field, marginTop: '8px' } },
          h('span', { style: styles.label }, t('scaffoldMcp')),
          h('textarea', {
            style: { ...styles.input, minHeight: '76px', fontFamily: 'monospace', resize: 'vertical' },
            value: mcpJson,
            placeholder: '[{"serverName":"github","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}}]',
            onChange: (event) => setMcpJson(event.target.value),
            'data-embodiment-scaffold-mcp': '1',
          }),
        ),
        h('p', { style: sub }, t('scaffoldMcpHint')),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
          h('span', null, t('scaffoldOverwrite')),
        ),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: writeAgents, onChange: (event) => setWriteAgents(event.target.checked) }),
          h('span', null, t('scaffoldAgents')),
        ),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: processSkills, onChange: (event) => setProcessSkills(event.target.checked) }),
          h('span', null, t('scaffoldProcessSkills')),
        ),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
          h('button', { type: 'button', style: styles.button, disabled: busy || !templateId, onClick: preview, 'data-embodiment-scaffold-preview': '1' }, t('scaffoldPreview')),
          h('button', { type: 'button', style: styles.button, disabled: busy || !templateId, onClick: generate, 'data-embodiment-scaffold-generate': '1' }, busy ? t('scaffoldGenerating') : t('scaffoldGenerate')),
        ),
        error ? h('p', { style: { ...styles.error, margin: '8px 0 0' }, 'data-embodiment-scaffold-error': '1' }, `${t('scaffoldError')}: ${error}`) : null,
        generated ? h('p', { style: sub, 'data-embodiment-scaffold-generated': '1' }, t('scaffoldGenerated')) : null,
        plan ? h('div', { style: { marginTop: '10px' } },
          h('div', { style: sub }, `${t('scaffoldFiles')} · ${plan.presetId || ''} · ${plan.bundleDir || ''}`),
          plan.agentsPath ? h('div', { style: sub }, `AGENTS.md · ${plan.agentsPath}`) : null,
          h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '11.5px', maxHeight: '240px', overflow: 'auto' } },
            files.map((file) => h('li', { key: file.path }, file.path)),
          ),
          warnings.length > 0 ? h('div', { style: styles.banner, title: warnings.join(' | ') },
            h('strong', null, `${t('scaffoldWarnings')}: `), warnings.join(' · '),
          ) : null,
          plan.installCommand ? h('div', { style: { marginTop: '8px' } },
            h('div', { style: styles.label }, t('scaffoldInstall')),
            h('pre', { style: { margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11.5px' } }, plan.installCommand),
            h('button', { type: 'button', style: { ...styles.button, marginTop: '6px' }, onClick: () => copy(plan.installCommand), 'data-embodiment-scaffold-copy': '1' }, copied ? t('scaffoldCopied') : t('scaffoldCopy')),
          ) : null,
        ) : h('p', { style: sub }, t('scaffoldEmpty')),
      )
    }

