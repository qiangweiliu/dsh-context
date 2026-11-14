    const styles = {
      page: { height: '100%', minHeight: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      pageInner: { maxWidth: '1040px', margin: '0 auto', padding: '24px clamp(16px, 4vw, 40px) 48px', display: 'flex', flexDirection: 'column', gap: '16px' },
      root: { display: 'flex', flexDirection: 'column', gap: '12px' },
      // tab 内容区单独一层容器只为承载 role=tabpanel / aria-labelledby：纵向节奏与 root 相同，
      // 视觉与之前「卡片直接排在 root 里」一致。
      tabPanel: { display: 'flex', flexDirection: 'column', gap: '12px' },
      title: { margin: 0, fontSize: '21px', fontWeight: 600, lineHeight: '29px', letterSpacing: '-0.01em' },
      versionChip: { display: 'inline-flex', alignItems: 'center', borderRadius: '999px', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', padding: '1px 8px', fontSize: '11.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
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
      dot: { width: '8px', height: '8px', borderRadius: '2px', display: 'inline-block' },
      bar: { background: 'var(--dsw-alias-interactive-bg-hover)', borderRadius: '999px', height: '8px', display: 'flex', overflow: 'hidden' },
      barFill: { borderRadius: '999px', height: '100%', minWidth: '2px' },
      barSegment: { height: '100%', minWidth: '2px' },
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
      // ── KPI / 图例 ────────────────────────────────────────────────────────
      kpi: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', minWidth: 0 },
      kpiLabel: { fontSize: '10.5px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiValue: { fontSize: '17px', lineHeight: '23px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiSub: { fontSize: '10px', lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      legend: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '5px 14px', margin: '2px 0 0', padding: 0 },
      legendItem: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      legendName: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      legendValue: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' },
      // ── 状态 badge ──────────────────────────────────────────────────────
      badge: { display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 600, lineHeight: '18px', border: '0.5px solid transparent', whiteSpace: 'nowrap' },
      badgeOk: { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'var(--dsw-alias-state-success-primary)' },
      badgeWarn: { color: 'var(--dsw-alias-state-warn-primary)', borderColor: 'var(--dsw-alias-state-warn-primary)' },
      badgeError: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
      barWrap: { position: 'relative' },
      barTick: { position: 'absolute', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--dsw-alias-label-tertiary)', opacity: 0.55, pointerEvents: 'none' },
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
      kpiBand: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: '12px', overflow: 'hidden' },
      kpiCard: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
      kpiCardDivider: { borderLeft: '0.5px solid var(--dsw-alias-border-l1)' },
      kpiCardLabel: { fontSize: '10.5px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiCardValue: { fontSize: '15.5px', lineHeight: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiCardSub: { fontSize: '10px', lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      billingBody: { display: 'flex', gap: '28px', alignItems: 'flex-start', flexWrap: 'wrap' },
      billingTotal: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '128px' },
      billingTotalLabel: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
      billingTotalValue: { fontSize: '27px', lineHeight: '34px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      billingRows: { flex: '1 1 360px', minWidth: 0 },
      billingRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 0.8fr)', gap: '12px', alignItems: 'center', padding: '4px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      billingRowLabel: { fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      billingRowTokens: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
      billingRowCost: { fontSize: '11.5px', color: 'var(--dsw-alias-label-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
      billingNote: { margin: 0, fontSize: '10.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-tertiary)' },
      chartWrap: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
      chartBars: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '96px', paddingTop: '6px', overflowX: 'auto' },
      chartBarCol: { flex: '1 1 0', minWidth: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' },
      chartBar: { width: '100%', maxWidth: '26px', borderRadius: '4px 4px 1px 1px', background: 'var(--dsw-alias-brand-primary)', minHeight: '2px', opacity: 0.88 },
      chartBarZero: { background: 'var(--dsw-alias-interactive-bg-hover)' },
      chartLabel: { fontSize: '9.5px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      sessionList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' },
      sessionCard: { textAlign: 'left', border: '0.5px solid var(--dsw-alias-border-l1)', background: 'transparent', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '5px', cursor: 'pointer', color: 'inherit', minWidth: 0 },
      sessionCardOn: { borderColor: 'var(--dsw-alias-brand-primary)' },
      sessionTitle: { margin: 0, fontSize: '12.5px', fontWeight: 600, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sessionMeta: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sessionStats: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      trendBody: { display: 'flex', alignItems: 'flex-start', gap: '6px', minWidth: 0 },
      trendAxis: { flex: 'none', width: '38px', height: '130px', boxSizing: 'border-box', paddingBottom: '18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '9.5px', lineHeight: '12px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      trendScroll: { overflowX: 'auto', paddingBottom: '4px', flex: '1 1 auto', minWidth: 0 },
      trendCols: { display: 'flex', alignItems: 'flex-end', gap: '3px', minHeight: '130px', minWidth: '100%', position: 'relative' },
      trendGridLine: { position: 'absolute', left: 0, right: 0, borderTop: '0.5px solid var(--dsw-alias-border-l1)', pointerEvents: 'none' },
      trendCol: { flex: '1 0 18px', maxWidth: '48px', height: '130px', boxSizing: 'border-box', paddingBottom: '18px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 0, position: 'relative', zIndex: 1 },
      trendLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center', fontSize: '9.5px', lineHeight: '12px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      trendPrompt: { width: '100%', borderRadius: '0 0 3px 3px', background: 'var(--dsw-static-blue-450)', minHeight: '2px' },
      trendOutput: { width: '100%', borderRadius: '3px 3px 0 0', background: 'var(--dsw-static-green-400)', minHeight: '1px' },
      trendMarker: { position: 'absolute', top: 0, bottom: '18px', left: 0, width: '2px', background: 'var(--dsw-alias-state-warn-primary)', opacity: 0.85, zIndex: 2, pointerEvents: 'none' },
      trendMarkerDot: { position: 'absolute', top: '-2px', left: '-3px', width: '8px', height: '8px', borderRadius: '999px', background: 'var(--dsw-alias-state-warn-primary)' },
      trendBudgetLabel: { position: 'absolute', right: 0, top: '-14px', padding: '0 3px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-tertiary)', fontSize: '9px', lineHeight: '12px', whiteSpace: 'nowrap' },
      trendLegendItem: { display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 },
      legendInline: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      filterBar: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      eventList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0' },
      eventItem: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)', minWidth: 0 },
      eventKind: { flex: 'none', fontSize: '10px', fontWeight: 600, borderRadius: '4px', padding: '0 5px', lineHeight: '17px', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)' },
      eventMain: { flex: '1 1 auto', minWidth: 0, fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' },
      eventAside: { flex: 'none', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      searchInput: { width: '100%', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', padding: '5px 9px', fontSize: '12px' },
      linkAction: { marginLeft: 'auto', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer' },
      banner: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
      checkList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px' },
      checkItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
      insightList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 },
      insightItem: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      insightText: { flex: '1 1 auto', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)' },
      alertStrip: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '7px 10px', borderRadius: '9px', border: '0.5px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsw-alias-bg-layer-2)' },
      alertRow: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
      alertDot: { width: '6px', height: '6px', borderRadius: '999px', background: 'var(--dsw-alias-state-warn-primary)', flex: 'none' },
      compareGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' },
      compareRows: { display: 'flex', flexDirection: 'column', gap: 0 },
      compareRow: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', padding: '5px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1)', fontSize: '11.5px' },
      compareValue: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' },
      pricingRows: { display: 'flex', flexDirection: 'column', gap: '5px' },
      pricingRow: { display: 'grid', gridTemplateColumns: 'minmax(120px, 1.6fr) repeat(4, minmax(52px, 0.7fr)) auto', gap: '5px', alignItems: 'center' },
      detailBox: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)' },
      error: { margin: 0, fontSize: '11.5px', color: 'var(--dsw-alias-state-error-primary)' },
      diffBox: { display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '220px', overflow: 'auto', border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '6px 8px', fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: '10.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      diffRemove: { color: 'var(--dsw-alias-state-error-primary)' },
      diffAdd: { color: 'var(--dsw-alias-state-success-primary)' },
    })

    // ── 基础视觉组件 ────────────────────────────────────────────────────────

    /** 小号环形用量：规格与内置 ContextMeter 一致（14px、2px 描边）。 */
    function ContextRing(props) {
      const percent = Math.max(0, Math.min(100, Number(props.percent) || 0))
      const radius = 5.5
      const circumference = 2 * Math.PI * radius
      return h(
        'svg',
        {
          viewBox: '0 0 14 14',
          width: 14,
          height: 14,
          'aria-hidden': true,
          style: { flex: 'none' },
          'data-embodiment-dock-ring': String(Math.round(percent)),
        },
        h('circle', { cx: 7, cy: 7, r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 2 }),
        h('circle', {
          cx: 7,
          cy: 7,
          r: radius,
          fill: 'none',
          stroke: 'var(--dsw-alias-label-tertiary)',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
          transform: 'rotate(-90 7 7)',
        }),
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
            { key: row.key, style: styles.legendItem, 'data-embodiment-legend': row.key, title: `${row.label} · ${formatTokens(row.tokens)} ${props.tokensLabel || ''}` },
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
            // 0% 时不画 2px 残留色块，空条就应该是空的。
            minWidth: grown && percent > 0 ? '2px' : 0,
            background: props.color || 'var(--dsw-alias-brand-primary)',
            transition: 'width .7s cubic-bezier(.22,.61,.36,1)',
          },
        }),
      )
    }

    // ── 卡片折叠状态（记忆到 localStorage，按卡片 id 存） ──────────────────
    const COLLAPSED_STORAGE_KEY = 'agent-embodiment:collapsed:v1'

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

