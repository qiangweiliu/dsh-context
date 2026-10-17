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
 * 预算从哪来（三级）：
 *   1. 会话级临时覆盖：宿主半侧 `/ctx <tokens>` 写入（同包 ./state.js 共享）
 *   2. 全局默认：宿主半侧 Config.contextWindowTokens
 *   3. 本行 Config.maxContextTokens（0 = 跟随前两级；宿主没装时才用它）
 *
 * 控制语义（v1，只走官方 seam，不 import 任何包）：
 *   - mode: 'idle'     每轮结束（agent/status === 'idle'）检查用量，超过预算就调用
 *                      `compaction.compactNow()` 强制压缩；压完仍超会重试（maxAttempts）。
 *   - mode: 'pre-step' 每个 step 边界调用 `compaction.compactIfNeeded(agent, 'pressure',
 *                      signal)`，把触发时机交给本插件（配合把 `compaction-basic.auto` 关掉）。
 *   - mode: 'notify'   只测量并写日志，不动作。
 *   - mode: 'off'      完全禁用。
 * 另注册 `/ctx-compact` 手动强制压缩一次（同样要求 agent 空闲）。
 *
 * 压缩目标按「降到预算以下即可」实现：复用引擎自己的选区逻辑（compactNow），
 * 不自己算范围、不写 surfaceOp、不碰影子价。
 */

import {
  budgetFor,
  getSessionDisabledPrompts,
  getSessionDisabledTools,
  getGlobalDisabledTools,
  getGlobalPromptOverrides,
  recordAppliedTools,
  recordCompaction,
  recordInventory,
  recordSyncDebug,
  setControlActive,
} from './state.js'

export const name = 'ctx-mon-and-con-control'

/** 硬依赖：没有测量服务就没有控制依据。 */
export const inject = ['tokenMeter']

/** 宿主没装、本行也没配时的兜底预算。 */
const FALLBACK_BUDGET = 100000

const DEFAULT_CONFIG = {
  /** 触发预算；0 = 跟随宿主默认与会话覆盖。 */
  maxContextTokens: 0,
  /** 触发时机：off / notify / idle / pre-step。 */
  mode: 'idle',
  /** 两次自动压缩之间的最小间隔，防止同一轮里反复触发。 */
  cooldownMs: 60000,
  /** 一次触发里最多连续压缩几次（压完仍超预算时重试）。 */
  maxAttempts: 2,
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
          const raw = Array.isArray(result.sections) ? result.sections : []
          const mapped = []
          const inventory = []
          for (const section of raw) {
            if (disabled.has(section.name)) continue
            const original = String(section.text === undefined || section.text === null ? '' : section.text)
            const overridden = Object.prototype.hasOwnProperty.call(overrides, section.name)
            const effective = overridden ? String(overrides[section.name]) : original
            // 原 section 可能是 frozen 的：不改它，重建一个 AssembledSection。
            const next = { name: section.name, text: effective }
            if (section.interpolate !== undefined) next.interpolate = section.interpolate
            mapped.push(next)
            inventory.push({
              name: section.name,
              tokens: Math.ceil(effective.length / 4),
              text: effective,
              originalText: original,
              overridden,
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

  /** 某会话的实际预算：会话覆盖 > 宿主默认 > 本行配置 > 兜底。 */
  const budgetOf = (agent) => budgetFor(sessionIdOf(agent), config.maxContextTokens || FALLBACK_BUDGET)

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
     * 反复压缩直到低于预算或压不动（「降到设置值以下即可」的实现）。
     * @returns {Promise<{ before: number, after: number | null, rounds: number, result: unknown }>}
     */
    const enforce = async (agent, trigger) => {
      const budget = budgetOf(agent)
      const first = measure(agent)
      const before = first ? first.totalTokens : 0
      if (!first || before <= budget) return { before, after: before, rounds: 0, result: null }
      log('info', `${trigger}: over budget ${formatTokens(before)} > ${formatTokens(budget)}`)
      let after = before
      let result = null
      let rounds = 0
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        const signal = new AbortController().signal
        result = await compaction.compactNow(agent, signal)
        rounds += 1
        const current = measure(agent)
        after = current ? current.totalTokens : after
        if (!result) break
        if (after <= budget) break
      }
      recordCompaction(sessionIdOf(agent), before, after, result?.shadowedTokenCount)
      log('info', `${trigger}: ${formatTokens(before)} → ${formatTokens(after)} in ${rounds} round(s) (budget ${formatTokens(budget)})`)
      if (after > budget) log('warn', `${trigger}: still above budget after ${rounds} round(s); nothing else safely compactable`)
      return { before, after, rounds, result }
    }

    if (config.mode === 'idle' || config.mode === 'notify') {
      sub.effect(
        () =>
          ctx.on('agent/status', ({ agent, status }) => {
            if (status !== 'idle') return
            const measurement = measure(agent)
            const budget = budgetOf(agent)
            if (!measurement || measurement.totalTokens <= budget) return
            if (config.mode === 'notify') {
              log('warn', `over budget (notify only): ${formatTokens(measurement.totalTokens)} > ${formatTokens(budget)}`)
              return
            }
            if (!throttle(agent)) return
            // 事件回调必须同步返回：压缩异步进行，失败只记日志，绝不影响轮次。
            void enforce(agent, 'idle').catch((error) => {
              log('warn', `idle compaction failed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }),
        'ctx-mon-and-con-control: idle budget enforcement',
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
              if (!measurement || measurement.totalTokens <= budget) return next()
              if (!throttle(agent)) return next()
              log('info', `over budget at step: ${formatTokens(measurement.totalTokens)} > ${formatTokens(budget)}`)
              // 复用引擎的阈值/选区/事务，只由我们决定触发时机。
              const before = measurement.totalTokens
              const result = await compaction.compactIfNeeded(agent, 'pressure', signal)
              const current = measure(agent)
              recordCompaction(sessionIdOf(agent), before, current ? current.totalTokens : before, result?.shadowedTokenCount)
              log('info', `step compaction: ${describeResult(result)}`)
            } catch (error) {
              if (!signal?.aborted) log('warn', `step compaction failed: ${error instanceof Error ? error.message : String(error)}`)
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
                  return { kind: 'success', text: `未超过预算（${formatTokens(before)} ≤ ${formatTokens(budgetOf(agent))}），无需压缩。` }
                }
                return {
                  kind: 'success',
                  text: [
                    `压缩完成：${formatTokens(before)} → ${typeof after === 'number' ? formatTokens(after) : '?'} tokens（${rounds} 轮，预算 ${formatTokens(budgetOf(agent))}）`,
                    `- ${describeResult(result)}`,
                  ].join('\n'),
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return { kind: 'error', text: `压缩失败：${message}（需要 agent 空闲，且会话里有可安全压缩的范围）` }
              }
            },
          }),
        'ctx-mon-and-con-control: /ctx-compact command',
      )
    })
  })
}
