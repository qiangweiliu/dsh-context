/**
 * ctx-mon-and-con-control — 本插件的「控制」半侧（preset 平面）。
 *
 * 与宿主平面的 index.js 不同，这个插件必须在 **agent preset 内部** 挂载：
 * Web 形态下 `dsh-web-app` 把宿主平面的 compaction 行全部置为 disabled，
 * 真正运行的 `compaction` 服务在 `preset-standard` 的 `cordis:group` 里
 * （`isolate: { compaction: true, toolResultPruner: true }`）。宿主上下文的
 * `ctx.get('compaction')` 是拿不到的，只有挂在同一 realm 里才看得到。
 *
 * 挂载方式（设置 → Agent preset，往 compaction 组里加一行）：
 *   - id: ctx-mon-and-con-control
 *     name: 'ctx-mon-and-con/control'
 *     config: { mode: idle }
 *
 * 上下文从哪来（三级）：
 *   1. 会话级临时覆盖：宿主半侧 `/ctx <tokens>` 写入（同包 ./state.js 共享）
 *   2. 全局默认：宿主半侧 Config.contextWindowTokens
 *   3. 本行 Config.maxContextTokens（0 = 跟随前两级；宿主没装时才用它）
 *
 * 控制语义（v1，只走官方 seam，不 import 任何包）：
 *   - 触发条件：`tokenMeter` 实测用量 > 插件上下文上限 × `triggerAt`（默认 1，
 *     即 100% 才触发；调到 0.75 就表示到警告比例预压缩）。
 *   - mode: 'idle'     每个 `agent/pre-step` 检查（受 cooldownMs 节流）：先调
 *                      `compaction.compactIfNeeded(agent, 'pressure')`；若没降到上限内，
 *                      再自己选较早的消息节点调 `compactRegion` 兜底（保留 keepTokens）。
 *   - mode: 'pre-step' 只在 step 边界调 `compactIfNeeded`，不做范围压缩兜底
 *                      （适合把 `compaction-basic.auto` 关掉后接管）。
 *   - mode: 'notify'   只在 `agent/status === 'idle'` 时测量并写日志，不动作。
 *   - mode: 'off'      完全禁用。
 * 另注册 `/ctx-compact` 手动强制压缩一次（不受 triggerAt 限制，仍要求 agent 空闲；
 * 用 compactNow，按 maxAttempts 重试）。
 *
 * 压缩目标按「降到上下文以下即可」实现：复用引擎自己的选区逻辑，不自己算范围、
 * 不写 surfaceOp、不碰影子价。
 */

import {
  budgetFor,
  getDefaultKeepTokens,
  getDefaultTargetAt,
  getDefaultTriggerAt,
  getSessionDisabledPrompts,
  getSessionDisabledTools,
  getGlobalDisabledTools,
  getSessionPromptTextMap,
  getGlobalPromptOverrides,
  recordAppliedTools,
  recordCompaction,
  recordCompactionEvent,
  recordControlError,
  recordInventory,
  recordSyncDebug,
  setCompacting,
  setControlActive,
} from './state.js'

export const name = 'ctx-mon-and-con-control'

/** 硬依赖：没有测量服务就没有控制依据。 */
export const inject = ['tokenMeter']

/** 宿主没装、本行也没配时的兜底上下文。 */
const FALLBACK_BUDGET = 100000

const DEFAULT_CONFIG = {
  /** 触发上下文；0 = 跟随宿主默认与会话覆盖。 */
  maxContextTokens: 0,
  /** 触发时机：off / notify / idle / pre-step。 */
  mode: 'idle',
  /** 两次自动压缩之间的最小间隔，防止同一轮里反复触发。 */
  cooldownMs: 60000,
  /** 一次触发里最多连续压缩几次（压完仍超出上下文时重试）。 */
  maxAttempts: 2,
  /** 压缩时保留的最近 tokens（0 = 用上下文上限的 25%）。 */
  keepTokens: 0,
}

const MODES = ['off', 'notify', 'idle', 'pre-step']
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)

/** 手写 Standard Schema（零依赖，和 index.js 同一风格）。 */
function validateConfig(input) {
  const issues = []
  const raw = input ?? {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { issues: [{ message: 'config must be an object' }] }
  }
  const config = { ...DEFAULT_CONFIG }
  for (const key of CONFIG_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (key === 'mode') {
      if (typeof value !== 'string' || !MODES.includes(value)) {
        issues.push({ message: `expected one of ${MODES.join(' | ')}`, path: ['mode'] })
        continue
      }
      config[key] = value
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ message: 'expected a finite number', path: [key] })
      continue
    }
    config[key] = value
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) issues.push({ message: 'unknown config key', path: [key] })
  }
  if (!Number.isInteger(config.maxContextTokens) || config.maxContextTokens < 0) {
    issues.push({ message: 'expected a non-negative integer', path: ['maxContextTokens'] })
  }
  if (!Number.isInteger(config.keepTokens) || config.keepTokens < 0) {
    issues.push({ message: 'expected a non-negative integer', path: ['keepTokens'] })
  }
  if (false) {
    issues.push({ message: 'expected a non-negative integer (0 = follow host default)', path: ['maxContextTokens'] })
  }
  if (!Number.isInteger(config.cooldownMs) || config.cooldownMs < 0) {
    issues.push({ message: 'expected a non-negative integer', path: ['cooldownMs'] })
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 10) {
    issues.push({ message: 'expected an integer between 1 and 10', path: ['maxAttempts'] })
  }
  if (issues.length > 0) return { issues }
  return { value: Object.freeze(config) }
}

export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'ctx-mon-and-con-control',
    validate: validateConfig,
  }),
})

const numberFormat = new Intl.NumberFormat('en-US')

function formatTokens(tokens) {
  return numberFormat.format(Math.max(0, Math.round(Number(tokens) || 0)))
}

function describeResult(result) {
  if (!result) return '无可安全压缩的范围'
  const count = Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : 0
  const tokens = result.shadowedTokenCount
  return `已压缩 ${count} 个表层节点${typeof tokens === 'number' ? `，约 ${formatTokens(tokens)} tokens` : ''}`
}

/**
 * @param ctx Cordis 上下文（tokenMeter 已就绪）
 * @param config 经 Config 校验后的配置
 */
export function apply(ctx, config) {
  // mode: 'off' 只停用压缩动作；工具/提示词清单与开关仍要生效。

  const log = (level, message) => {
    const logger = ctx.logger
    const write = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : undefined
    if (write) write(`ctx-mon-and-con-control: ${message}`)
  }

  /** 每个 agent 上次自动压缩的时间（WeakMap：agent 释放即回收）。 */
  const lastRun = new WeakMap()

  // ── 工具 / 提示词开关：按 agent 作用域应用 ────────────────────────────────
  const agentGates = new WeakMap()

  const syncGates = (agent) => {
    const sessionId = sessionIdOf(agent)
    try { if (sessionId) recordSyncDebug(sessionId, { gate: 'pre-step', hasCtx: Boolean(agent?.ctx), hasTools: Boolean(agent?.ctx?.tools), deny: getSessionDisabledTools(sessionId) }) } catch {}
    if (!sessionId || !agent?.ctx) return
    let gate = agentGates.get(agent)
    if (!gate) {
      gate = { denyKey: '', dispose: null, promptInstalled: false }
      agentGates.set(agent, gate)
    }
    const deny = [...new Set([...getSessionDisabledTools(sessionId), ...getGlobalDisabledTools()])]
    const key = deny.join('\u0000')
    if (key !== gate.denyKey) {
      try {
        gate.dispose?.()
      } catch {}
      gate.dispose = deny.length > 0 && typeof agent.ctx.tools?.restrict === 'function' ? agent.ctx.tools.restrict({ deny }) : null
      gate.denyKey = key
      recordAppliedTools(sessionId, deny)
    }
    if (!gate.promptInstalled && typeof agent.ctx.on === 'function') {
      gate.promptInstalled = true
      agent.ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
        const result = await next()
        try {
          const disabled = new Set(getSessionDisabledPrompts(sessionId))
          const overrides = getGlobalPromptOverrides()
          const sessionTexts = getSessionPromptTextMap(sessionId) || new Map()
          const raw = Array.isArray(result.sections) ? result.sections : []
          const mapped = []
          const inventory = []
          for (const section of raw) {
            if (disabled.has(section.name)) continue
            const original = String(section.text === undefined || section.text === null ? '' : section.text)
            const globalOverridden = Object.prototype.hasOwnProperty.call(overrides, section.name)
            const sessionOverridden = sessionTexts.has(section.name)
            const effective = sessionOverridden
              ? String(sessionTexts.get(section.name))
              : globalOverridden
                ? String(overrides[section.name])
                : original
            // 原 section 可能是 frozen 的：不改它，重建一个 AssembledSection。
            const next = { name: section.name, text: effective }
            if (section.interpolate !== undefined) next.interpolate = section.interpolate
            mapped.push(next)
            inventory.push({
              name: section.name,
              tokens: Math.ceil(effective.length / 4),
              text: effective,
              originalText: original,
              overridden: globalOverridden || sessionOverridden,
              globalOverridden,
              sessionOverridden,
            })
          }
          result.sections = mapped
          recordInventory(sessionId, {
            sections: inventory,
            tools: (result.tools || []).map((tool) => ({
              name: tool.name,
              description: typeof tool.description === 'string' ? tool.description : undefined,
              parameters: tool.parameters,
              tokens: Math.ceil(JSON.stringify(tool).length / 4),
            })),
          })
        } catch (error) {
          log('warn', `assemble hook failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        return result
      })
    }
  }

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    try {
      syncGates(agent)
    } catch (error) {
      log('warn', `toggle sync failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return next()
  })

  ctx.on('agent/created', ({ agent }) => {
    try {
      syncGates(agent)
    } catch {}
  })

  const sessionIdOf = (agent) => agent?.session?.id ?? agent?.sessionId

  /** 某会话的实际上下文：会话覆盖 > 宿主默认 > 本行配置 > 兜底。 */
  const budgetOf = (agent) => budgetFor(sessionIdOf(agent), config.maxContextTokens || FALLBACK_BUDGET)

  /** 自动压缩的触发线：上下文上限 × triggerAt（宿主半侧 Config.triggerAt，默认 1）。 */
  const triggerTokensOf = (budget) => {
    const ratio = getDefaultTriggerAt()
    return typeof ratio === 'number' && ratio > 0 && ratio <= 1 ? budget * ratio : budget
  }

  /** 压缩目标线：上下文上限 × targetAt（默认 0.6；压到这条线以下就停）。 */
  const targetTokensOf = (budget) => {
    const ratio = getDefaultTargetAt()
    return typeof ratio === 'number' && ratio > 0 && ratio < 1 ? budget * ratio : budget * 0.6
  }

  /**
   * 选出“最小可压前缀”：只压到够得着 target 的较早消息，最近 keepTokens / 25% 预算不碰。
   * 返回 null 表示没有足够可安全压缩的历史（调用方据此跳过，而不是记失败）。
   */
  const planRegion = (agent, measurement, budget, target) => {
    const nodes = Array.isArray(measurement?.nodes) ? measurement.nodes : []
    const tokensOf = (node) => Number(node.tokens ?? node.heuristicTokens ?? 0)
    const typeOf = (node) => {
      try {
        const event = agent?.session && typeof agent.session.eventAt === 'function' ? agent.session.eventAt(node.seq) : undefined
        return event?.type
      } catch {
        return undefined
      }
    }
    // 跳过 system，只压较早的 user/assistant 消息（tool 结果也属于可压历史）。
    const messageNodes = nodes.filter((node, index) => {
      if (index === 0) return false
      const type = typeOf(node)
      if (type === undefined) return true
      return type === 'user/message' || type === 'assistant/message' || type === 'tool/result'
    })
    if (messageNodes.length < 2) return null
    const keepFloor = config.keepTokens > 0 ? config.keepTokens : getDefaultKeepTokens() > 0 ? getDefaultKeepTokens() : Math.max(1, Math.floor(budget * 0.25))
    // 最近 keepFloor tokens 作为“不动区”，只在它之前选可压范围。
    let reserve = 0
    let keepFrom = messageNodes.length
    let floorMet = false
    for (let index = messageNodes.length - 1; index >= 0; index -= 1) {
      reserve += tokensOf(messageNodes[index])
      if (reserve >= keepFloor) {
        keepFrom = index
        floorMet = true
        break
      }
    }
    if (!floorMet) return null
    const candidates = messageNodes.slice(0, keepFrom)
    if (candidates.length < 2) return null
    const needed = Math.max(0, Number(measurement.totalTokens) - target)
    let accumulated = 0
    let cut = 0
    for (let index = 0; index < candidates.length; index += 1) {
      accumulated += tokensOf(candidates[index])
      if (accumulated >= needed) {
        cut = index + 1
        break
      }
    }
    // 可压历史不够达到 target：只压能压的部分（仍受 keepFloor 限制）。
    if (cut === 0) cut = candidates.length
    // compactRegion 至少要覆盖 2 个节点，避免把单条消息切碎。
    cut = Math.max(2, cut)
    const selected = candidates.slice(0, Math.min(cut, candidates.length))
    if (selected.length < 2) return null
    const selectedTokens = selected.reduce((sum, node) => sum + tokensOf(node), 0)
    if (selectedTokens < Math.max(200, Math.min(keepFloor, needed))) return null
    return { start: selected[0].seq, end: selected[selected.length - 1].seq, tokens: selectedTokens }
  }

  /** 测量；任何异常都返回 null，绝不打断轮次。 */
  const measure = (agent) => {
    const session = agent?.session
    if (!session) return null
    try {
      const measurement = ctx.tokenMeter.measure(session)
      return typeof measurement?.totalTokens === 'number' ? measurement : null
    } catch (error) {
      log('warn', `measure failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** 记录一次压缩结果（成功/失败）；失败同时更新 lastError。 */
  const logCompaction = (event) => {
    try {
      recordCompactionEvent(event)
    } catch {}
  }
  const logCompactionFailure = (trigger, message, extra) => {
    recordControlError(message)
    logCompaction({ outcome: 'failure', trigger, message, ...(extra || {}) })
  }

  const throttle = (agent) => {
    const now = Date.now()
    const last = lastRun.get(agent) ?? 0
    if (config.cooldownMs > 0 && now - last < config.cooldownMs) return false
    lastRun.set(agent, now)
    return true
  }

  // 控制动作只在能看到 compaction 服务的 realm 里注册；宿主平面里拿不到时
  // 整个控制半侧保持 inactive（不会抛错），插件其余部分不受影响。
  ctx.inject(['compaction'], (sub) => {
    const compaction = sub?.compaction
    if (!compaction) return

    setControlActive(config.mode !== 'off', config.mode)
    sub.effect(
      () => () => setControlActive(false),
      'ctx-mon-and-con-control: activation state',
    )

    /**
     * 反复压缩直到低于上下文或压不动（「降到设置值以下即可」的实现）。
     * @returns {Promise<{ before: number, after: number | null, rounds: number, result: unknown }>}
     */
    const enforce = async (agent, trigger) => {
      const budget = budgetOf(agent)
      const target = targetTokensOf(budget)
      const first = measure(agent)
      const before = first ? first.totalTokens : 0
      if (!first || before <= budget) return { before, after: before, rounds: 0, result: null }
      log('info', `${trigger}: over budget ${formatTokens(before)} > ${formatTokens(budget)}`)
      let after = before
      let result = null
      let rounds = 0
      const startedAt = Date.now()
      setCompacting(true)
      try {
        for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
          const signal = new AbortController().signal
          result = await compaction.compactNow(agent, signal)
          rounds += 1
          const current = measure(agent)
          after = current ? current.totalTokens : after
          if (!result) break
          if (after <= target) break
        }
      } finally {
        setCompacting(false)
      }
      recordCompaction(sessionIdOf(agent), before, after, result?.shadowedTokenCount)
      const compacted = after < before
      logCompaction({
        outcome: compacted ? 'success' : 'failure',
        trigger,
        sessionId: sessionIdOf(agent),
        before,
        after,
        budget,
        target: Math.round(target),
        durationMs: Date.now() - startedAt,
        rounds,
        shadowed: result?.shadowedTokenCount,
        message: compacted ? null : `压缩后用量未降低（${formatTokens(before)} → ${formatTokens(after)}，上限 ${formatTokens(budget)}）`,
      })
      log('info', `${trigger}: ${formatTokens(before)} → ${formatTokens(after)} in ${rounds} round(s) (budget ${formatTokens(budget)})`)
      if (after > budget) log('warn', `${trigger}: still above budget after ${rounds} round(s); nothing else safely compactable`)
      return { before, after, rounds, result }
    }

    if (config.mode === 'idle') {
      sub.effect(
        () =>
          ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
            try {
              if (signal?.aborted) return next()
              const first = measure(agent)
              const budget = budgetOf(agent)
              if (!first || first.totalTokens <= triggerTokensOf(budget)) return next()
              const target = targetTokensOf(budget)
              const planned = planRegion(agent, first, budget, target)
              // 预压缩（triggerAt < 1）且没有可安全压缩的历史：静默跳过，不写 failure / lastError。
              if (!planned && first.totalTokens <= budget) {
                log('info', `pre-compaction skipped at ${formatTokens(first.totalTokens)}: no compactable history`)
                return next()
              }
              if (!throttle(agent)) return next()
              setCompacting(true)
              const startedAt = Date.now()
              const before = first.totalTokens
              let after = first
              let result = null
              let rounds = 0
              try {
                // 1) 先让引擎按自己的阈值压一次；引擎没动作就落到范围压缩兜底。
                try {
                  result = await compaction.compactIfNeeded(agent, 'pressure', signal)
                  after = measure(agent) ?? after
                  rounds += 1
                } catch (error) {
                  if (signal?.aborted) return next()
                  log('warn', `idle engine compaction failed: ${error instanceof Error ? error.message : String(error)}`)
                  after = measure(agent) ?? after
                }
                // 2) 没到 target 就继续压“最小可压前缀”，最多 maxAttempts 轮；无进展即停。
                for (let round = 0; round < config.maxAttempts; round += 1) {
                  if (signal?.aborted) return next()
                  if (after.totalTokens <= target) break
                  const planNow = planRegion(agent, after, budget, target)
                  if (!planNow) break
                  try {
                    await compaction.compactRegion(planNow.start, planNow.end, agent, signal)
                  } catch (error) {
                    if (signal?.aborted) return next()
                    log('warn', `idle region compaction failed: ${error instanceof Error ? error.message : String(error)}`)
                    break
                  }
                  rounds += 1
                  const current = measure(agent) ?? after
                  const progressed = current.totalTokens < after.totalTokens
                  after = current
                  if (!progressed) break
                }
                if (after.totalTokens < before) {
                  recordCompaction(sessionIdOf(agent), before, after.totalTokens)
                  logCompaction({ outcome: 'success', trigger: 'idle', sessionId: sessionIdOf(agent), before, after: after.totalTokens, budget, target: Math.round(target), durationMs: Date.now() - startedAt, rounds, shadowed: result?.shadowedTokenCount })
                  if (after.totalTokens > target) log('warn', `idle: still above target ${formatTokens(target)} after ${rounds} round(s)`)
                } else {
                  const reason = before <= budget
                    ? `达到预压缩阈值但用量未降低（${formatTokens(before)} → ${formatTokens(after.totalTokens)}）；当前没有可安全压缩的历史`
                    : `压缩后用量未降低（${formatTokens(before)} → ${formatTokens(after.totalTokens)}，上限 ${formatTokens(budget)}）；当前预算可能低于系统提示+工具定义的基础开销，或没有可安全压缩的历史`
                  logCompactionFailure('idle', reason, { sessionId: sessionIdOf(agent), before, after: after.totalTokens, budget, target: Math.round(target), durationMs: Date.now() - startedAt })
                }
              } finally {
                setCompacting(false)
              }
            } catch (error) {
              if (!signal?.aborted) logCompactionFailure('idle', error instanceof Error ? error.message : String(error), { sessionId: sessionIdOf(agent) })
            }
            return next()
          }),
        'ctx-mon-and-con-control: budget enforcement before request (idle mode)',
      )
    }

    if (config.mode === 'notify') {
      sub.effect(
        () =>
          ctx.on('agent/status', ({ agent, status }) => {
            if (status !== 'idle') return
            const measurement = measure(agent)
            const budget = budgetOf(agent)
            if (!measurement || measurement.totalTokens <= triggerTokensOf(budget)) return
            log('warn', `over trigger (notify only): ${formatTokens(measurement.totalTokens)} > ${formatTokens(triggerTokensOf(budget))} (budget ${formatTokens(budget)})`)
          }),
        'ctx-mon-and-con-control: notify-only measurement',
      )
    }

    if (config.mode === 'pre-step') {
      sub.effect(
        () =>
          ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
            try {
              if (signal?.aborted) return next()
              const measurement = measure(agent)
              const budget = budgetOf(agent)
              if (!measurement || measurement.totalTokens <= triggerTokensOf(budget)) return next()
              if (!throttle(agent)) return next()
              log('info', `over trigger at step: ${formatTokens(measurement.totalTokens)} > ${formatTokens(triggerTokensOf(budget))} (budget ${formatTokens(budget)})`)
              // 复用引擎的阈值/选区/事务，只由我们决定触发时机。
              setCompacting(true)
              try {
                const before = measurement.totalTokens
                const result = await compaction.compactIfNeeded(agent, 'pressure', signal)
                const current = measure(agent)
                const after = current ? current.totalTokens : before
                recordCompaction(sessionIdOf(agent), before, after, result?.shadowedTokenCount)
                logCompaction({ outcome: after < before ? 'success' : 'failure', trigger: 'step', sessionId: sessionIdOf(agent), before, after, budget, rounds: 1, shadowed: result?.shadowedTokenCount, message: after < before ? null : `step 压缩后用量未降低（${formatTokens(before)} → ${formatTokens(after)}，上限 ${formatTokens(budget)}）` })
                log('info', `step compaction: ${describeResult(result)}`)
              } finally {
                setCompacting(false)
              }
            } catch (error) {
              if (!signal?.aborted) {
                logCompactionFailure('step', error instanceof Error ? error.message : String(error), { sessionId: sessionIdOf(agent) })
                log('warn', `step compaction failed: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
            return next()
          }),
        'ctx-mon-and-con-control: step-boundary enforcement',
      )
    }

    // 手动入口：/ctx-compact —— 立刻对该会话做一次 idle 压缩（mode: off 时不注册）。
    if (config.mode !== 'off') ctx.inject(['commands'], (commandSub) => {
      const commands = commandSub?.commands
      if (!commands?.register) return
      commandSub.effect(
        () =>
          commands.register({
            name: 'ctx-compact',
            description: 'Compact the current session now (idle only)',
            handler: async (invocation) => {
              const { agent, signal } = invocation ?? {}
              if (!agent?.session) return { kind: 'error', text: '当前没有可用会话，无法压缩。' }
              if (signal?.aborted) return { kind: 'error', text: '已取消。' }
              try {
                const { before, after, result, rounds } = await enforce(agent, 'manual')
                if (rounds === 0) {
                  return { kind: 'success', text: `未超过上下文（${formatTokens(before)} ≤ ${formatTokens(budgetOf(agent))}），无需压缩。` }
                }
                return {
                  kind: 'success',
                  text: [
                    `压缩完成：${formatTokens(before)} → ${typeof after === 'number' ? formatTokens(after) : '?'} tokens（${rounds} 轮，上下文 ${formatTokens(budgetOf(agent))}）`,
                    `- ${describeResult(result)}`,
                  ].join('\n'),
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logCompactionFailure('manual', message, { sessionId: sessionIdOf(agent) })
                return { kind: 'error', text: `压缩失败：${message}（需要 agent 空闲，且会话里有可安全压缩的范围）` }
              }
            },
          }),
        'ctx-mon-and-con-control: /ctx-compact command',
      )
    })
  })
}
