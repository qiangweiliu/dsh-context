    const en = {
      nav: 'Context',
      panel: 'Context',
      ctxBrand: 'context',
      title: 'Context',
      pageTitle: 'Context',
      versionLabel: 'Plugin version',
      reloadUi: 'Reload page',
      reloadHint: 'The plugin was updated; reload the page to load the new UI (no DSH restart needed).',
      description: 'See where context goes, control compaction and tools, and keep the agent preset healthy.',
      budget: 'Context limit',
      budgetLimit: 'Budget cap',
      used: 'Measured',
      remaining: 'Remaining',
      ratio: 'Used',
      pluginBudgetTag: 'plugin budget',
      statusOk: 'ok',
      statusWarn: 'warning',
      statusError: 'over the context limit',
      warnAt: 'Warn at',
      errorAt: 'Error at',
      triggerAt: 'Trigger at',
      compressionStrategy: 'Compression strategy',
      strategyConservative: 'Conservative — compress at 90%, keep more',
      strategyBalanced: 'Balanced — pre-compress at 90%, keep 25%',
      strategyAggressive: 'Aggressive — early compression, keep 10%',
      triggerLabel: 'Trigger ratio',
      invalidTrigger: 'Trigger ratio must be in (0, 1].',
      triggerHint: 'Auto-compaction triggers when usage reaches this share of the budget (1 = only at the limit; 0.75 = pre-compress at the warn ratio).',
      targetAt: 'Target at',
      targetLabel: 'Target ratio',
      invalidTarget: 'Target ratio must be in (0, 1) and below the trigger ratio.',
      invalidAnalyticsLimit: 'Analytics session limit must be an integer from 1 to 200.',
      compacting: 'Compacting…',
      compactingHint: 'Compaction is running; the next request may wait a moment.',
      recent: 'Recent /embody measurements',
      refresh: 'Refresh',
      collapse: 'Collapse',
      expand: 'Expand',
      lastDelta: 'Since last sync',
      retry: 'Retry',
      error: 'Could not load status',
      errorUnauthorized: 'This session is no longer authenticated. Refresh the page or sign in again.',
      errorForbidden: 'This session cannot access the plugin API. Refresh the page or check the token.',
      errorUnavailable: 'The plugin service is temporarily unavailable. Try again in a moment.',
      errorNetwork: 'Could not reach the plugin. Check that the DSH instance is still running.',
      cardFailed: 'This card failed to render: {message}',
      hint: 'Tip: /embody <tokens> temporarily overrides this session; /embody reset restores the default. /ctx is a legacy alias.',
      tokens: 'tokens',
      control: 'Control',
      controlOn: 'enabled',
      controlOff: 'not active',
      controlReady: 'Control row is mounted in the agent preset; the context limit is enforced automatically.',
      controlMissing: 'Not active yet — mount agent-embodiment/control inside the agent preset (Settings → Agent preset → compaction group).',
      controlRequired: 'Prompt and tool changes need the control row. Mount agent-embodiment/control in the agent preset first.',
      controlLast: 'Last compaction',
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
      analyticsLimitLabel: 'Analytics session limit',
      analyticsLimitHint: 'How many recent sessions Trend/Overview scan (1–200; default 40).',
      configUnavailable: 'This client cannot edit the Host configuration — values are read-only here.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The plugin reloaded with the new configuration.',
      saveRefused: 'The Host refused the write.',
      saveFailed: 'Save failed',
      invalidTokens: 'Context limit must be a positive integer.',
      invalidRatios: 'Thresholds must be in (0, 1] and warn must be below error.',
      defaultBudgetShort: 'Default limit',
      warnLabel: 'Warn ratio',
      errorLabel: 'Error ratio',
      meterAria: 'ctx context limit',
      pluginContext: 'Plugin context',
      pluginContextAria: 'Plugin context {percent} used',
      pluginContextHint: 'The percentage uses the plugin budget for this session; the built-in meter uses the model window.',
      balance: 'Balance',
      balanceTopped: 'Topped up',
      balanceBonus: 'Granted',
      balanceSignedOut: 'Sign in to view the balance',
      balanceUnavailable: 'Balance unavailable',
      balanceCheckPlatform: 'View on the platform',
      balanceTopUp: 'Top up',
      balanceRefresh: 'DSH account balance; click to refresh',
      balanceLoading: 'Loading balance…',
      balanceToggleTitle: 'Balance capsule',
      balanceToggleHint: 'Off by default. Your choice is saved locally and restored after restarting DSH.',
      balanceEnable: 'Enable',
      balanceDisable: 'Disable',
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
      confirm: 'Confirm',
      cancel: 'Cancel',
      restoreAll: 'Restore all',
      restoreConfirm: 'Clears session toggles and session prompt text, global prompt edits and global tool disables. Continue?',
      tokensShort: 'tokens',
      copy: 'Copy',
      copied: 'Copied',
      parameters: 'Parameters (JSON Schema)',
      source: 'Source',
      sourceUnknown: 'unidentified',
      edit: 'Edit',
      resetOriginal: 'Restore original',
      globalOverridden: 'overridden (global)',
      sessionOverridden: 'overridden (session)',
      saveSession: 'Save to this session',
      saveGlobal: 'Save globally',
      savedSession: 'Saved for this session (applies to the next request).',
      savedGlobal: 'Saved globally.',
      confirmGlobal: 'Save globally? It affects every session and is written to the profile.',
      resetSession: 'Reset session override',
      editHint: 'Writes profile config (global). Original kept for restore.',
      diffPreview: 'Preview changes',
      diffDelta: '{delta} net tokens vs current text',
      diffNoChange: 'No changes yet.',
      toolDisabledImpact: 'Disabled — frees about {tokens} tokens of tool schema in this session (the control row must be mounted).',
      toolDisabledImpactUnknown: 'Disabled — this session no longer offers the tool to the agent.',
      toolDisableWarning: 'Turning a tool off removes it from the agent this session; turn it back on to restore it.',
      alertToggle: 'Show alert strip and dock dot',
      alertToggleHint: 'Warnings appear when context is above the warn line or the control row is inactive.',
      extraPromptAdd: 'Add prompt',
      extraPromptName: 'Prompt name',
      extraPromptText: 'Prompt text',
      extraPromptSave: 'Add',
      extraPromptSaved: 'Added. It appears in the next request.',
      extraPromptHint: 'Choose where it applies; changes take effect on the next request.',
      extraPromptPlacement: 'Append to',
      extraPromptSystem: 'System prompt',
      extraPromptUser: 'End of every user message',
      extraPromptSystemBadge: 'system',
      extraPromptUserBadge: 'per message',
      extraPromptSwitchUser: 'Move to message end',
      extraPromptSwitchSystem: 'Move to system prompt',
      extraPromptDelete: 'Delete',
      extraPromptTemplates: 'Templates',
      extraPromptTemplateMethod: 'Working method',
      extraPromptTemplateMethodName: 'Working method',
      extraLabel: 'extra',
      promptTokens: 'Prompt',
      toolTokens: 'Tools',
      historyTokens: 'History',
      userTokens: 'This turn',
      tabsOverview: 'Overview',
      tabsTrend: 'Trend',
      tabsEvents: 'Events',
      tabsSettings: 'Settings',
      tabsScaffold: 'Agent',
      tabsLabel: 'Sections',
      scaffoldTitle: 'Agent embodiment scaffold',
      scaffoldIntro: 'Generate a DSH agent preset with senses, hands, skills, and a verification loop.',
      scaffoldTemplate: 'Template',
      scaffoldTarget: 'Workspace directory',
      scaffoldTargetHint: 'Absolute path on the DSH host. Files go under .dsh/scaffolds and .agents/skills.',
      scaffoldName: 'Display name',
      scaffoldSlug: 'Preset id',
      scaffoldPreview: 'Preview',
      scaffoldGenerate: 'Generate pack',
      scaffoldGenerating: 'Generating…',
      scaffoldFiles: 'Files',
      scaffoldWarnings: 'Warnings',
      scaffoldInstall: 'Install command',
      scaffoldGenerated: 'Generated. Install it in the running profile, then choose the preset for a new session.',
      scaffoldError: 'Scaffold failed',
      scaffoldTargetRequired: 'Enter an absolute workspace path.',
      scaffoldOverwrite: 'Overwrite existing files',
      scaffoldAgents: 'Merge a marked section into AGENTS.md',
      scaffoldProcessSkills: 'Include process skills (sense-environment, verify-change)',
      scaffoldMcp: 'MCP servers (JSON, optional)',
      scaffoldMcpHint: 'Array of { serverName, transport: "stdio"|"streamable-http", command/args/env or url/headers }. Use ${ENV_VAR} for secrets. The command will be launched locally after you install the generated preset.',
      scaffoldMcpInvalid: 'MCP JSON is not valid JSON.',
      scaffoldCopy: 'Copy',
      scaffoldCopied: 'Copied',
      scaffoldEmpty: 'Preview to see the files this preset will create.',
      labsTitle: 'Labs: Agent scaffold',
      labsHint: 'Experimental and separate from the context loop. Only repo-coder and web-researcher are validated.',
      onboardingTitle: 'Set up context control',
      onboardingIntro: 'Three steps, about a minute. You can skip; budget and strategy stay editable in Settings.',
      onboardingBudget: '1. Confirm the budget',
      onboardingBudgetHint: 'This is the plugin budget used for percentages and compaction — not the model window. Check the built-in ContextMeter for the model window.',
      onboardingStrategy: '2. Pick a compaction strategy',
      onboardingPreset: '3. Authorize the control row',
      onboardingPresetHint: 'The plugin can add one row to the agent preset so compaction can run. Without it, prompt/tool controls are read-only.',
      onboardingPresetYes: 'Allow writing the control row',
      onboardingPresetNo: 'I will mount it manually',
      onboardingFinish: 'Finish setup',
      onboardingLater: 'Later',
      onboardingDone: 'Setup complete. You can change it any time in Settings.',
      onboardingReopen: 'Reopen setup',
      sessionBudget: 'Session budget',
      sessionBudgetHint: 'Overrides the budget for this session only; takes precedence over the control row and host default.',
      sessionBudgetNoSession: 'Open a session first to set its budget.',
      sessionBudgetCurrent: 'Current override',
      sessionBudgetSaved: 'Saved',
      sessionBudgetFailed: 'Save failed',
      clear: 'Clear',
      onboardingReopenHint: 'You skipped first-run setup. You can reopen it any time.',
      onboardingBudgetRequired: 'Confirm a positive budget first.',
      healthTitle: 'Control health',
      healthOk: 'All core checks pass',
      healthIssue: 'Needs attention',
      healthFix: 'Repair control row',
      healthRecheck: 'Recheck',
      healthControl: 'Control row active',
      healthPreset: 'Control row present in the agent preset',
      healthConfig: 'Host config is editable',
      healthBudget: 'Budget confirmed',
      healthMeasurement: 'At least one measurement',
      healthManual: 'If the row is present but inactive, reload this page or restart DSH once.',
      healthFixed: 'Repair requested. Recheck in a few seconds.',
      insightsTitle: 'What to do next',
      insightToolShare: '{share} of this session is tool schemas ({tokens} tokens). Review low-use tools.',
      insightUnusedTools: '{count} tools were not called in the scanned sessions ({tokens} tokens of schema).',
      insightRepeatedCompaction: '{sessions} sessions compacted repeatedly ({compactions} total). Consider a larger budget or a less aggressive strategy.',
      insightCompactionFailures: '{count} compaction failures. Open Events for the error and retry command.',
      insightUnknownPricing: '{sessions} sessions have no price ({tokens} tokens). Add a model price to include them.',
      insightCostOutlier: '{title} costs {multiple}× the median session ({cost}). Open it to see why.',
      insightOpen: 'Open',
      insightsEmpty: 'No actionable issues in the scanned range.',
      savingsTitle: 'Context reduction (est.)',
      savingsCompactions: '{count} compactions',
      savingsTokens: '{tokens} tokens removed',
      savingsCost: '≈ {cost} avoided on the next request',
      savingsMethod: 'before→after per compaction, Flash input rate; not a full billing reconciliation',
      dataScope: 'Scope: latest {scanned}/{total} sessions (limit {limit})',
      exportJson: 'Export JSON',
      exportConfirmHint: 'The export includes local absolute paths (cwd). Download anyway?',
      exportConfirmYes: 'Download',
      exportCsv: 'Export CSV',
      clearData: 'Clear local data',
      clearDataHint: 'Deletes local compaction logs and/or session toggles. Profile config is not touched.',
      clearLogs: 'Clear compaction log',
      clearToggles: 'Clear session toggles',
      clearAllData: 'Clear logs and toggles',
      clearDataConfirm: 'This cannot be undone. Continue?',
      cleared: 'Local data cleared.',
      compareTitle: 'Compare sessions',
      compareA: 'Session A',
      compareB: 'Session B',
      compareTokens: 'Tokens',
      compareRequests: 'Requests',
      compareCost: 'Cost (est.)',
      compareCompactions: 'Compactions',
      compareEmpty: 'Pick two sessions to compare.',
      topCost: 'Top cost',
      pricingTitle: 'Model pricing',
      pricingHint: 'CNY per 1M tokens. Rows are evaluated top-down; the first match wins. Unknown models stay blank.',
      pricingHolidays: 'Holidays: {builtin} built-in + {custom} custom = {total} days (off-peak all day)',
      pricingHolidaysIgnoreBuiltin: 'built-in table ignored',
      pricingMatch: 'Model regex',
      pricingInput: 'Input',
      pricingCacheRead: 'Cache read',
      pricingCacheWrite: 'Cache write',
      pricingOutput: 'Output',
      pricingAdd: 'Add price row',
      pricingRemove: 'Remove',
      pricingSave: 'Save prices',
      pricingSaved: 'Prices saved.',
      pricingEmpty: 'No custom price rows. Built-in DeepSeek prices still apply.',
      previewTitle: 'Preview change',
      previewDelta: 'Token delta: {delta}',
      previewNoChange: 'No text change.',
      previewConfirm: 'Confirm save',
      previewHint: 'Only this section is previewed; the full prompt is assembled on the next request.',
      undo: 'Undo',
      undoDone: 'Reverted.',
      toolImpact: 'Disabling removes ~{tokens} tokens of schema from the next request.',
      toolRisk: 'This looks like a high-impact tool. The agent may lose file/shell capability.',
      promptNextHint: 'Takes effect on the next request.',
      alertControlMissing: 'The control row is not active; budget enforcement and prompt/tool changes will not run.',
      alertBudgetWarn: 'Context is above the warning line ({percent}).',
      alertBudgetError: 'Context is over the error line ({percent}). Compact or raise the budget.',
      alertCompactionFailed: 'The last compaction failed. See Events for details.',
      notifyTitle: 'In-page alerts',
      notifyHint: 'Show a warning strip in the panel and a dot on the dock when context is high or control is inactive.',
      notifyEnable: 'Enable',
      notifyDisable: 'Disable',
      range7: '7 days',
      range30: '30 days',
      rangeAll: 'All',
      kpiSessions: 'Sessions',
      kpiTokens: 'Tokens',
      kpiCache: 'Cache hit',
      kpiTools: 'Tool calls',
      kpiActive: 'Active time',
      kpiCompactions: 'Compactions',
      costUnknown: 'no price for this model',
      costEstimated: 'estimated from official peak/off-peak rates',
      billingTitle: 'Billing (est.)',
      costLabel: 'Cost',
      costEstimateLabel: 'Cost (est.)',
      costTotal: 'Total',
      costCacheHit: 'Cache hit input',
      costCacheMiss: 'Cache miss input',
      costCacheWrite: 'Cache write input',
      costOutput: 'Output',
      costPeak: 'peak',
      costOffPeak: 'off-peak',
      costPricingNote: 'Converted with DeepSeek official CNY peak/off-peak rates; Search/Fetch not included',
      costRateUnit: 'per 1M tokens',
      costRateExample: 'rate example',
      costNow: 'now',
      costCustom: 'custom pricing',
      readFailures: '{count} sessions could not be read',
      coverage: 'Scanned {scanned}/{total} sessions',
      coverageShort: '{scanned}/{total} scanned',
      dailyTitle: 'Tokens per day',
      sessionsTitle: 'Recent sessions',
      searchSessions: 'Search title / workspace / id',
      noSessions: 'No sessions in this range',
      sortRecent: 'Newest',
      sortTokens: 'Tokens',
      sortCost: 'Cost',
      openSession: 'Open chat',
      trendTitle: 'Request context trend',
      trendPrompt: 'Input',
      trendOutput: 'Output',
      trendCompaction: 'Compaction',
      trendPeak: 'Peak',
      trendAfterCompaction: 'after compaction',
      requestsUnit: 'requests',
      sessionLabel: 'Session',
      trendNoData: 'No completed requests yet',
      eventsTitle: 'Compaction & injections',
      eventAll: 'All',
      eventSuccess: 'Success',
      eventFailure: 'Failure',
      eventCompaction: 'Compaction',
      eventInject: 'Injection',
      noEvents: 'No matching events',
      turnsLabel: 'Turns',
      requestsLabel: 'Requests',
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
      nav: '上下文',
      panel: '上下文',
      ctxBrand: 'context',
      title: '上下文',
      pageTitle: '上下文',
      versionLabel: '插件版本',
      reloadUi: '刷新页面',
      reloadHint: '插件已更新，刷新页面即可加载新界面（无需重启 DSH）。',
      description: '看清上下文花在哪，控制压缩与工具，并保持 agent preset 健康。',
      budget: '上下文',
      budgetLimit: '预算上限',
      used: '实测用量',
      remaining: '剩余',
      ratio: '已用',
      pluginBudgetTag: '插件预算',
      statusOk: '正常',
      statusWarn: '警告',
      statusError: '已超限',
      warnAt: '警告阈值',
      errorAt: '超限阈值',
      triggerAt: '触发阈值',
      compressionStrategy: '压缩策略',
      strategyConservative: '保守 —— 90% 压缩，保留更多',
      strategyBalanced: '均衡 —— 90% 预压缩，保留 25%',
      strategyAggressive: '激进 —— 提前压缩，保留 10%',
      triggerLabel: '触发比例',
      invalidTrigger: '触发比例必须在 (0, 1] 之间。',
      triggerHint: '用量达到预算的这个比例时自动压缩（1 = 到上限才触发；0.75 = 到警告比例就预压缩）。',
      targetAt: '目标阈值',
      targetLabel: '目标比例',
      invalidTarget: '目标比例必须在 (0, 1) 之间，且小于触发比例。',
      invalidAnalyticsLimit: '分析会话上限必须是 1–200 的整数。',
      compacting: '压缩中…',
      compactingHint: '正在压缩历史；下一次请求可能会等待片刻。',
      recent: '最近的 /embody 测量',
      refresh: '刷新',
      collapse: '收起',
      expand: '展开',
      lastDelta: '较上次同步',
      retry: '重试',
      error: '读取状态失败',
      errorUnauthorized: '本会话登录已失效，请刷新页面或重新登录。',
      errorForbidden: '本会话无权访问插件接口，请刷新页面或检查 token。',
      errorUnavailable: '插件服务暂时不可用，请稍后重试。',
      errorNetwork: '无法连接插件，请确认 DSH 实例仍在运行。',
      cardFailed: '本卡片渲染失败：{message}',
      hint: '提示：/embody <tokens> 临时覆盖本会话上下文；/embody reset 恢复默认；/ctx 是兼容别名。',
      tokens: 'tokens',
      control: '控制',
      controlOn: '已启用',
      controlOff: '未启用',
      controlReady: '控制行已挂在 agent preset 内，超出上下文会自动压缩。',
      controlMissing: '尚未生效 —— 需要把 agent-embodiment/control 加到 agent preset 的 compaction 组里（设置 → Agent preset → compaction group）。',
      controlRequired: '提示词与工具修改需要控制行生效。请先把 agent-embodiment/control 挂进 agent preset。',
      controlLast: '最近一次压缩',
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
      analyticsLimitLabel: '分析会话上限',
      analyticsLimitHint: '概览/趋势最多扫描最近多少个会话（1–200，默认 40）。',
      configUnavailable: '当前客户端不能编辑宿主配置，这里只读。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件已按新配置重挂。',
      saveRefused: '宿主拒绝了这次写入。',
      saveFailed: '保存失败',
      invalidTokens: '上下文必须是正整数。',
      invalidRatios: '阈值必须在 (0, 1] 之间，且警告阈值要小于超限阈值。',
      defaultBudgetShort: '默认上限',
      warnLabel: '警告比例',
      errorLabel: '超限比例',
      meterAria: 'ctx 上下文',
      pluginContext: '插件上下文',
      pluginContextAria: '插件上下文已用 {percent}',
      pluginContextHint: '百分比按插件为本会话配置的上下文上限计算；token 构成与模型窗口口径见内置上下文指示器。',
      balance: '余额',
      balanceTopped: '充值',
      balanceBonus: '赠金',
      balanceSignedOut: '登录后查看余额',
      balanceUnavailable: '余额不可用',
      balanceCheckPlatform: '前往开放平台查看',
      balanceTopUp: '充值',
      balanceRefresh: 'DSH 账户余额，点击刷新',
      balanceLoading: '正在读取余额…',
      balanceToggleTitle: '余额胶囊',
      balanceToggleHint: '默认关闭；开启状态保存在本机，重启 DSH 后保留。',
      balanceEnable: '开启',
      balanceDisable: '关闭',
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
      confirm: '确认',
      cancel: '取消',
      restoreAll: '恢复全部',
      restoreConfirm: '将清除：会话开关、会话提示词文本覆盖、全局提示词覆盖、全局工具禁用。确认？',
      tokensShort: 'tokens',
      copy: '复制',
      copied: '已复制',
      parameters: '参数（JSON Schema）',
      source: '来源',
      sourceUnknown: '未识别',
      edit: '编辑',
      resetOriginal: '恢复原文',
      globalOverridden: '已覆盖（全局）',
      sessionOverridden: '已覆盖（会话）',
      saveSession: '仅保存到本会话',
      saveGlobal: '保存到全局',
      savedSession: '已保存到本会话（下一次请求生效）。',
      savedGlobal: '已保存到全局。',
      confirmGlobal: '确认保存到全局？将影响所有会话并写入 profile。',
      resetSession: '清除会话覆盖',
      editHint: '写入 profile 配置（全局生效），原文保留可恢复。',
      diffPreview: '改动预览',
      diffDelta: '相对当前文本净增减 {delta} tokens',
      diffNoChange: '暂未修改。',
      toolDisabledImpact: '已禁用 — 本会话预计释放约 {tokens} tokens 工具 schema（需控制行已挂载）。',
      toolDisabledImpactUnknown: '已禁用 — 本会话不再向 agent 提供该工具。',
      toolDisableWarning: '关闭工具后该会话的 agent 不再拿到它；重新打开即可恢复。',
      alertToggle: '显示告警条与底部圆点',
      alertToggleHint: '上下文超过警告线或控制行未挂载时给出提示。',
      extraPromptAdd: '新增提示词',
      extraPromptName: '提示词名称',
      extraPromptText: '提示词内容',
      extraPromptSave: '新增',
      extraPromptSaved: '已新增，下一次请求生效。',
      extraPromptHint: '选择放置位置；修改会在下一次请求生效。',
      extraPromptPlacement: '追加位置',
      extraPromptSystem: '系统提示词',
      extraPromptUser: '每次用户提问末尾',
      extraPromptSystemBadge: '系统',
      extraPromptUserBadge: '每次提问',
      extraPromptSwitchUser: '改为追加到提问末尾',
      extraPromptSwitchSystem: '改为系统提示词',
      extraPromptDelete: '删除',
      extraPromptTemplates: '模板',
      extraPromptTemplateMethod: '方法论（通用）',
      extraPromptTemplateMethodName: '方法论',
      extraLabel: '新增',
      promptTokens: '提示词',
      toolTokens: '工具定义',
      historyTokens: '上文',
      userTokens: '本轮用户对话',
      tabsOverview: '概览',
      tabsTrend: '趋势',
      tabsEvents: '事件',
      tabsSettings: '设置',
      tabsScaffold: 'Agent',
      tabsLabel: '分区',
      scaffoldTitle: 'Agent 脚手架',
      scaffoldIntro: '生成一个带感官、手、技能和验证闭环的 DSH agent preset。',
      scaffoldTemplate: '模板',
      scaffoldTarget: '工作区目录',
      scaffoldTargetHint: 'DSH 宿主上的绝对路径；文件写入 .dsh/scaffolds 与 .agents/skills。',
      scaffoldName: '显示名称',
      scaffoldSlug: 'Preset id',
      scaffoldPreview: '预览',
      scaffoldGenerate: '生成',
      scaffoldGenerating: '生成中…',
      scaffoldFiles: '文件',
      scaffoldWarnings: '警告',
      scaffoldInstall: '安装命令',
      scaffoldGenerated: '已生成。安装到当前 profile，然后在新会话里选择这个 preset。',
      scaffoldError: '脚手架生成失败',
      scaffoldTargetRequired: '请输入工作区的绝对路径。',
      scaffoldOverwrite: '覆盖已有文件',
      scaffoldAgents: '合并带标记的 section 到 AGENTS.md',
      scaffoldProcessSkills: '包含过程 skill（sense-environment、verify-change）',
      scaffoldMcp: 'MCP servers（JSON，可选）',
      scaffoldMcpHint: '{ serverName, transport: "stdio"|"streamable-http", command/args/env 或 url/headers } 数组；secret 用 ${ENV_VAR}。安装生成的 preset 后，这里的 command 会以本机命令启动。',
      scaffoldMcpInvalid: 'MCP JSON 格式不正确。',
      scaffoldCopy: '复制',
      scaffoldCopied: '已复制',
      scaffoldEmpty: '先预览，看看这个 preset 会生成哪些文件。',
      labsTitle: 'Labs：Agent 脚手架',
      labsHint: '实验能力，和上下文闭环分开；只有 repo-coder 与 web-researcher 经过验证。',
      onboardingTitle: '设置上下文控制',
      onboardingIntro: '三步，大约一分钟；可以跳过，预算和策略之后仍可在设置里修改。',
      onboardingBudget: '1. 确认预算',
      onboardingBudgetHint: '这里是插件用于百分比和压缩的预算，不是模型窗口；模型窗口见内置 ContextMeter。',
      onboardingStrategy: '2. 选择压缩策略',
      onboardingPreset: '3. 授权控制行',
      onboardingPresetHint: '插件可以往 agent preset 里加一行，压缩才会真正运行；不加则提示词/工具修改只读。',
      onboardingPresetYes: '允许写入控制行',
      onboardingPresetNo: '我自己挂载',
      onboardingFinish: '完成设置',
      onboardingLater: '稍后',
      onboardingDone: '设置完成；之后可在设置里随时修改。',
      onboardingReopen: '重新打开设置',
      sessionBudget: '本会话预算',
      sessionBudgetHint: '只覆盖当前会话的预算，优先级高于控制行与宿主默认值。',
      sessionBudgetNoSession: '先打开一个会话，才能设置它的预算。',
      sessionBudgetCurrent: '当前覆盖',
      sessionBudgetSaved: '已保存',
      sessionBudgetFailed: '保存失败',
      clear: '清除',
      onboardingReopenHint: '你跳过了首次设置，可以随时在这里重新打开。',
      onboardingBudgetRequired: '请先确认一个正整数预算。',
      healthTitle: '控制面健康',
      healthOk: '核心检查全部通过',
      healthIssue: '需要处理',
      healthFix: '修复控制行',
      healthRecheck: '重新检测',
      healthControl: '控制行已生效',
      healthPreset: '控制行已写入 agent preset',
      healthConfig: '宿主配置可编辑',
      healthBudget: '预算已确认',
      healthMeasurement: '至少有一次测量',
      healthManual: '如果控制行已存在但仍未生效，刷新页面或重启一次 DSH。',
      healthFixed: '已请求修复，几秒后重新检测。',
      insightsTitle: '接下来做什么',
      insightToolShare: '本会话 {share} 是工具定义（{tokens} tokens）。检查低频工具。',
      insightUnusedTools: '{count} 个工具在已扫描会话中没有被调用（共 {tokens} tokens schema）。',
      insightRepeatedCompaction: '{sessions} 个会话反复压缩（共 {compactions} 次）。考虑放宽预算或降低策略强度。',
      insightCompactionFailures: '{count} 次压缩失败。到事件页查看原因和重试命令。',
      insightUnknownPricing: '{sessions} 个会话没有价格（{tokens} tokens）。补充模型价格后可计入费用。',
      insightCostOutlier: '{title} 的费用是中位数的 {multiple} 倍（{cost}）。打开看看原因。',
      insightOpen: '查看',
      insightsEmpty: '当前范围内没有需要处理的问题。',
      savingsTitle: '上下文减少（估算）',
      savingsCompactions: '{count} 次压缩',
      savingsTokens: '减少 {tokens} tokens',
      savingsCost: '下一次请求约省 {cost}',
      savingsMethod: '按每次压缩前→后差值、Flash 输入价估算；不是完整账单对账',
      dataScope: '统计范围：最近 {scanned}/{total} 个会话（上限 {limit}）',
      exportJson: '导出 JSON',
      exportConfirmHint: '导出文件包含本机绝对路径（cwd），确认下载？',
      exportConfirmYes: '确认下载',
      exportCsv: '导出 CSV',
      clearData: '清理本地数据',
      clearDataHint: '只删除本地压缩日志和/或会话开关，不改 profile 配置。',
      clearLogs: '清理压缩日志',
      clearToggles: '清理会话开关',
      clearAllData: '清理日志和开关',
      clearDataConfirm: '此操作不可撤销，确认继续？',
      cleared: '本地数据已清理。',
      compareTitle: '会话对比',
      compareA: '会话 A',
      compareB: '会话 B',
      compareTokens: 'Tokens',
      compareRequests: '请求数',
      compareCost: '费用（估）',
      compareCompactions: '压缩次数',
      compareEmpty: '选择两个会话进行对比。',
      topCost: '费用最高',
      pricingTitle: '模型价格',
      pricingHint: '人民币 / 每百万 tokens；自上而下匹配，第一条命中生效；未知模型保持空白。',
      pricingHolidays: '节假日：内置 {builtin} 天 + 自定义 {custom} 天 = {total} 天（全天按空闲价）',
      pricingHolidaysIgnoreBuiltin: '已忽略内置表',
      pricingMatch: '模型正则',
      pricingInput: '输入',
      pricingCacheRead: '缓存命中',
      pricingCacheWrite: '缓存写入',
      pricingOutput: '输出',
      pricingAdd: '新增价格行',
      pricingRemove: '删除',
      pricingSave: '保存价格',
      pricingSaved: '价格已保存。',
      pricingEmpty: '没有自定义价格；内置 DeepSeek 价格仍生效。',
      previewTitle: '预览修改',
      previewDelta: 'Token 变化：{delta}',
      previewNoChange: '文本没有变化。',
      previewConfirm: '确认保存',
      previewHint: '只预览这个 section；完整提示词会在下一次请求时装配。',
      undo: '撤销',
      undoDone: '已撤销。',
      toolImpact: '禁用后下一次请求约减少 {tokens} tokens 的工具 schema。',
      toolRisk: '这看起来是高影响工具，禁用后 agent 可能失去文件/命令能力。',
      promptNextHint: '下一次请求生效。',
      alertControlMissing: '控制行未生效，预算约束和提示词/工具修改都不会运行。',
      alertBudgetWarn: '上下文已超过警告线（{percent}）。',
      alertBudgetError: '上下文已超过超限线（{percent}）。请压缩或提高预算。',
      alertCompactionFailed: '最近一次压缩失败，详情见事件页。',
      notifyTitle: '页内提醒',
      notifyHint: '上下文过高或控制行未生效时，在面板显示提示，并在 dock 上显示小圆点。',
      notifyEnable: '开启',
      notifyDisable: '关闭',
      range7: '近 7 天',
      range30: '近 30 天',
      rangeAll: '全部',
      kpiSessions: '会话数',
      kpiTokens: '累计 tokens',
      kpiCache: '缓存命中',
      kpiTools: '工具调用',
      kpiActive: '活跃时长',
      kpiCompactions: '压缩次数',
      costUnknown: '该模型暂无价格',
      costEstimated: '按官方峰谷价估算',
      billingTitle: '计费（估算）',
      costLabel: '费用',
      costEstimateLabel: '费用（估）',
      costTotal: '合计',
      costCacheHit: '输入（缓存命中）',
      costCacheMiss: '输入（缓存未命中）',
      costCacheWrite: '输入（缓存写入）',
      costOutput: '输出',
      costPeak: '高峰',
      costOffPeak: '空闲',
      costPricingNote: '按 DeepSeek 官方人民币峰谷价逐条换算；不含 Search/Fetch',
      costRateUnit: '每百万 tokens',
      costRateExample: '价目示例',
      costNow: '当前',
      costCustom: '自定义价格',
      readFailures: '{count} 个会话读取失败',
      coverage: '已扫描 {scanned}/{total} 个会话',
      coverageShort: '{scanned}/{total} 已扫描',
      dailyTitle: '每日 tokens',
      sessionsTitle: '最近会话',
      searchSessions: '搜索标题 / 工作区 / id',
      noSessions: '该范围内没有会话',
      sortRecent: '最近',
      sortTokens: 'Tokens',
      sortCost: '费用',
      openSession: '打开会话',
      trendTitle: '请求上下文趋势',
      trendPrompt: '输入',
      trendOutput: '输出',
      trendCompaction: '压缩',
      trendPeak: '峰值',
      trendAfterCompaction: '压缩后',
      requestsUnit: '次请求',
      sessionLabel: '会话',
      trendNoData: '还没有完成的请求',
      eventsTitle: '压缩与注入事件',
      eventAll: '全部',
      eventSuccess: '成功',
      eventFailure: '失败',
      eventCompaction: '压缩',
      eventInject: '注入',
      noEvents: '没有匹配的事件',
      turnsLabel: '轮数',
      requestsLabel: '请求数',
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
    let workspaceService = null
    const sessionServiceSubscribers = new Set()

    function publishSessionService(service) {
      sessionService = service
      for (const notify of sessionServiceSubscribers) notify()
    }

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
      // sessions 服务可能比组件晚注入；用 service 状态 + 订阅两层，避免只拿一次快照。
      const [service, setService] = react.useState(sessionService)
      const [id, setId] = react.useState(() => currentSessionId())
      react.useEffect(() => {
        const notify = () => setService(sessionService)
        sessionServiceSubscribers.add(notify)
        notify()
        return () => sessionServiceSubscribers.delete(notify)
      }, [])
      react.useEffect(() => {
        if (!service) return undefined
        setId(currentSessionId())
        return service.list.subscribe(() => setId(currentSessionId()))
      }, [service])
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

    /** 人民币计费显示：>=1 分显示两位，小额显示四位，低于 0.0001 元显示上界。 */
    function formatCost(value) {
      if (value === null || value === undefined) return '—'
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (number === 0) return '¥0.00'
      if (number < 0.0001) return '<¥0.0001'
      if (number < 0.01) return `¥${number.toFixed(4)}`
      return `¥${number.toFixed(2)}`
    }

    /**
     * 把原始 fetch 错误映射成可操作文案。error 形如 "HTTP 401"、"TypeError: Failed to fetch"
     * 或自定义 message；这里只按状态码 / 网络错误分类，保留原始信息供诊断。
     * @param {any} error 原始错误（可能是 Error 或字符串）
     * @param {(key: string) => string} t 词典函数
     * @returns {string} 人话文案 + 原始信息
     */
    function humanizeError(error, t) {
      const raw = String((error && error.message) || error || '')
      const status = /HTTP\s+(\d{3})/iu.exec(raw)?.[1]
      const base = status === '401'
        ? t('errorUnauthorized')
        : status === '403'
          ? t('errorForbidden')
          : status === '404' || status === '503' || status === '500'
            ? t('errorUnavailable')
            : /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/iu.test(raw)
              ? t('errorNetwork')
              : null
      // 有原始信息时附上，方便复制诊断；没有映射到已知类别就原样返回。
      if (!base) return raw || t('error')
      return raw && !/^HTTP\s+\d{3}\s*$/u.test(raw) ? `${base}（${raw}）` : base
    }

    /** 趋势图纵轴：把峰值向上取整到 1/2/5×10^n 的刻度，避免每根柱子都顶满。 */
    function niceAxisMax(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return 1
      const rough = number / 3
      const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
      const normalized = rough / magnitude
      const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
      return Math.ceil(number / step) * step
    }

    /** 与 DSH 账号页一致的金额格式：两位小数，低于一分钱时显示 <¥0.01。 */
    function formatWalletAmount(amount, currency) {
      const symbol = currency === 'USD' ? '$' : '¥'
      const number = Number(amount)
      if (!Number.isFinite(number)) return `${symbol}${amount}`
      if (number === 0) return `${symbol}0.00`
      if (number < 0) return `-${symbol}${number > -0.01 ? '0.01' : Math.abs(number).toFixed(2)}`
      if (number < 0.01) return `<${symbol}0.01`
      return `${symbol}${number.toFixed(2)}`
    }

    /** 充值余额 + 赠金余额按币种合并，供 dock 胶囊显示。 */
    function walletSummary(balance) {
      const totals = new Map()
      for (const wallet of [...((balance && balance.value) || []), ...((balance && balance.bonusWallets) || [])]) {
        const amount = Number(wallet && wallet.balance)
        if (!Number.isFinite(amount)) continue
        totals.set(wallet.currency, (totals.get(wallet.currency) || 0) + amount)
      }
      return [...totals.entries()].map(([currency, amount]) => formatWalletAmount(amount, currency)).join(' / ')
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

    /** 提示词预览的轻量 diff：优先显示公共前后缀之间的变化，避免整段重排。 */
    function promptDiff(before, after) {
      const left = String(before || '').split('\n')
      const right = String(after || '').split('\n')
      let start = 0
      while (start < left.length && start < right.length && left[start] === right[start]) start += 1
      let endLeft = left.length - 1
      let endRight = right.length - 1
      while (endLeft >= start && endRight >= start && left[endLeft] === right[endRight]) {
        endLeft -= 1
        endRight -= 1
      }
      const rows = []
      for (let index = start; index <= endLeft; index += 1) rows.push({ kind: 'remove', text: left[index] })
      for (let index = start; index <= endRight; index += 1) rows.push({ kind: 'add', text: right[index] })
      if (rows.length === 0) return { rows: [], deltaTokens: 0 }
      const deltaTokens = Math.ceil((String(after || '').length - String(before || '').length) / 4)
      return { rows: rows.slice(0, 80), deltaTokens }
    }

    const NOTIFY_KEY = 'agent-embodiment:alerts:v1'
    function readAlertsEnabled() {
      try {
        return window.localStorage.getItem(NOTIFY_KEY) !== '0'
      } catch {
        return true
      }
    }
    function setAlertsEnabled(value) {
      try {
        window.localStorage.setItem(NOTIFY_KEY, value ? '1' : '0')
      } catch {}
    }
    function useAlertsEnabled() {
      const [enabled, setEnabled] = react.useState(readAlertsEnabled)
      react.useEffect(() => {
        const sync = () => setEnabled(readAlertsEnabled())
        window.addEventListener('storage', sync)
        return () => window.removeEventListener('storage', sync)
      }, [])
      return [enabled, (value) => { setAlertsEnabled(value); setEnabled(value) }]
    }

    /** ok / warn / error —— 与 ratioColor 的阈值一致，用于状态 badge 与文字。 */
    function StatusBadge(props) {
      const t = props.t
      const state = props.state || 'ok'
      const label = props.label || (state === 'error' ? t('statusError') : state === 'warn' ? t('statusWarn') : t('statusOk'))
      const style = state === 'error' ? styles.badgeError : state === 'warn' ? styles.badgeWarn : styles.badgeOk
      return h('span', { style: { ...styles.badge, ...style }, 'data-embodiment-status': state }, h('i', { style: { ...styles.dot, width: '6px', height: '6px', borderRadius: '999px', background: 'currentColor' } }), label)
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
      const bar = h(
        'div',
        { style: styles.bar },
        filled.map((row) =>
          h('div', {
            key: row.key,
            'data-embodiment-seg': row.key,
            title: `${row.label} · ${compactTokens(row.tokens)} (${formatPercent(row.share)})`,
            style: {
              ...styles.barSegment,
              width: `${(grown ? usedRatio * row.share * 100 : 0).toFixed(3)}%`,
              minWidth: grown && usedRatio > 0 ? '2px' : 0,
              background: row.color,
              transition: 'width .7s cubic-bezier(.22,.61,.36,1)',
            },
          }),
        ),
      )
      // 阈值刻度直接画在水位条上，省掉一排 chip；0%/100% 分别是条两端，不重复画。
      // 刻度只靠颜色区分，读屏不可达，所以带 aria-label；文案由调用方通过 tickLabels 传入，
      // 组件本身不碰词典（0.26.0 曾在这里直接调 t() 而抛 ReferenceError）。
      if (!props.ticks) return bar
      const labels = props.tickLabels || {}
      const tick = (ratio, color, label) => (typeof ratio === 'number' && ratio > 0 && ratio < 1 ? h('i', { key: ratio, role: 'presentation', 'aria-label': label || '', style: { ...styles.barTick, left: `${ratio * 100}%`, background: color } }) : null)
      return h('div', { style: styles.barWrap, role: 'img', 'aria-label': filled.map((row) => `${row.label} ${formatPercent(row.share)}`).join('，') }, bar, tick(props.warnAt, 'var(--dsw-alias-state-warn-primary)', labels.warn), tick(props.errorAt, 'var(--dsw-alias-state-error-primary)', labels.error))
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
    }

    // ── 面板视觉（参考 dsh-context 的卡片/标题/chip/图例语义） ───────────────
