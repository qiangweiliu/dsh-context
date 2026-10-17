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
 *     config: { maxContextTokens: 100000, mode: idle }
 *
 * 控制语义（v1，只走官方 seam，不 import 任何包）：
 *   - mode: 'idle'     每轮结束（agent/status === 'idle'）检查用量，超过
 *                      maxContextTokens 就调用 `compaction.compactNow()` 强制压缩。
 *   - mode: 'pre-step' 每个 step 边界调用 `compaction.compactIfNeeded(agent,
 *                      'pressure', signal)`，把触发时机交给本插件（配合把
 *                      `compaction-basic.auto` 关掉使用）。
 *   - mode: 'notify'   只测量并写日志，不动作。
 *   - mode: 'off'      完全禁用。
 * 另注册 `/ctx-compact` 手动强制压缩一次（同样要求 agent 空闲）。
 *
 * 全部依赖都从 ctx 上取，零 import：宿主包在 app.asar 里，第三方插件无法裸
 * import `@deepseek-ai/*`（会 ERR_MODULE_NOT_FOUND）。
 */

export const name = 'ctx-mon-and-con-control'

/** 硬依赖：没有测量服务就没有控制依据。 */
export const inject = ['tokenMeter']

const DEFAULT_CONFIG = {
  /** 超过这个 token 数就压缩。 */
  maxContextTokens: 100000,
  /** 触发时机：off / notify / idle / pre-step。 */
  mode: 'idle',
  /** 两次自动压缩之间的最小间隔，防止同一轮里反复触发。 */
  cooldownMs: 60000,
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
  if (!Number.isInteger(config.maxContextTokens) || config.maxContextTokens <= 0) {
    issues.push({ message: 'expected a positive integer', path: ['maxContextTokens'] })
  }
  if (!Number.isInteger(config.cooldownMs) || config.cooldownMs < 0) {
    issues.push({ message: 'expected a non-negative integer', path: ['cooldownMs'] })
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
  if (config.mode === 'off') return

  const log = (level, message) => {
    const logger = ctx.logger
    const write = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : undefined
    if (write) write(`ctx-mon-and-con-control: ${message}`)
  }

  /** 每个 agent 上次自动压缩的时间（WeakMap：agent 释放即回收）。 */
  const lastRun = new WeakMap()

  /** @returns {object | null} 超预算时的测量快照。 */
  const overBudget = (agent) => {
    const session = agent?.session
    if (!session) return null
    let measurement
    try {
      measurement = ctx.tokenMeter.measure(session)
    } catch (error) {
      log('warn', `measure failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    if (typeof measurement?.totalTokens !== 'number') return null
    return measurement.totalTokens > config.maxContextTokens ? measurement : null
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

    const compactIdle = async (agent) => {
      const signal = new AbortController().signal
      const before = overBudget(agent)
      if (!before) return null
      log('info', `over budget at idle: ${formatTokens(before.totalTokens)} > ${formatTokens(config.maxContextTokens)}`)
      const result = await compaction.compactNow(agent, signal)
      log('info', `idle compaction: ${describeResult(result)}`)
      return result
    }

    if (config.mode === 'idle' || config.mode === 'notify') {
      sub.effect(
        () =>
          ctx.on('agent/status', ({ agent, status }) => {
            if (status !== 'idle') return
            const measurement = overBudget(agent)
            if (!measurement) return
            if (config.mode === 'notify') {
              log('warn', `over budget (notify only): ${formatTokens(measurement.totalTokens)} > ${formatTokens(config.maxContextTokens)}`)
              return
            }
            if (!throttle(agent)) return
            // 事件回调必须同步返回：压缩异步进行，失败只记日志，绝不影响轮次。
            void compactIdle(agent).catch((error) => {
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
              const measurement = overBudget(agent)
              if (!measurement) return next()
              if (!throttle(agent)) return next()
              log('info', `over budget at step: ${formatTokens(measurement.totalTokens)} > ${formatTokens(config.maxContextTokens)}`)
              // 复用 compaction-basic 的阈值/选区/事务，只由我们决定触发时机。
              const result = await compaction.compactIfNeeded(agent, 'pressure', signal)
              log('info', `step compaction: ${describeResult(result)}`)
            } catch (error) {
              if (!signal?.aborted) log('warn', `step compaction failed: ${error instanceof Error ? error.message : String(error)}`)
            }
            return next()
          }),
        'ctx-mon-and-con-control: step-boundary enforcement',
      )
    }

    // 手动入口：/ctx-compact —— 复制了 `/compact` 的语义，但只走一次 idle 压缩。
    ctx.inject(['commands'], (commandSub) => {
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
                const measurement = ctx.tokenMeter.measure(agent.session)
                const result = await compaction.compactNow(agent, signal ?? new AbortController().signal)
                const after = (() => {
                  try {
                    return ctx.tokenMeter.measure(agent.session)
                  } catch {
                    return null
                  }
                })()
                const lines = [
                  `压缩完成：${formatTokens(measurement.totalTokens)} → ${after ? formatTokens(after.totalTokens) : '?'} tokens`,
                  `- ${describeResult(result)}`,
                ]
                return { kind: 'success', text: lines.join('\n') }
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
