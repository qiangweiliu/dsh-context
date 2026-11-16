/**
 * 宿主平面的运行时上下文（0.38.0）。
 *
 * 背景：`index.js::apply()` 里原本散着 15 个模块级可变绑定（服务句柄、运行时提示词、
 * 状态缓存、串行队列）和 6 个路径常量，共 200+ 个引用点。handler 直接读这些闭包变量，
 * 因此只能靠启动完整 Cordis 上下文间接测试，`statusHandler` 这类「依赖十几个闭包」的
 * 路由完全无法拆分。
 *
 * 这一层把「状态 + 路径」收进一个可注入的对象：
 * - index.js 通过 `runtime.getX()/setX()` 访问，不再各自持有 `let`；
 * - handler 只需拿 `runtime` 一个依赖，就能脱离 Cordis 单测（假 runtime 直接喂）。
 *
 * 不含业务逻辑：这里只管状态与路径，判断仍留在调用方。
 */
import { join } from 'node:path'

/**
 * @param {{
 *   config: any,
 *   home: string,
 *   dshHome: string,
 *   stateDir: string,
 *   legacyStateDir: string,
 *   profileName: string | null,
 *   initialOnboarding?: any,
 * }} options
 */
export function createRuntime(options) {
  const {
    config,
    home,
    dshHome,
    stateDir,
    legacyStateDir,
    profileName = null,
    initialOnboarding = null,
  } = options

  const paths = Object.freeze({
    home,
    dshHome,
    stateDir,
    legacyStateDir,
    profileName,
    backupDir: join(stateDir, 'backups'),
    sessionTogglesPath: join(stateDir, 'session-toggles.json'),
    onboardingPath: join(stateDir, 'onboarding.json'),
    compactionLogPath: join(stateDir, 'compaction-log.jsonl'),
  })

  // ── 宿主注入的服务句柄（晚绑定，可能为 null）──
  let sessions = null
  let sessionQuery = null
  let connection = null
  let configEditor = null
  let sessionProjections = null
  // 技能注册表（@deepseek-ai/dsh-skill 提供的 `skills` 服务）。只读用途：列目录、取正文。
  let skills = null
  let webServerPresent = false

  // ── 状态缓存 ──
  let statusRevision = 0
  let statusCache = { at: 0, revision: -1, text: '' }

  // ── 运行时提示词/工具状态（初值来自 config，写入后由 re-apply 重建）──
  let promptOverrides = { ...(config?.promptOverrides || {}) }
  let extraPrompts = { ...(config?.extraPrompts || {}) }
  let extraPromptPlacements = { ...(config?.extraPromptPlacements || {}) }
  let disabledTools = Array.isArray(config?.disabledTools) ? [...config.disabledTools] : []

  // ── 首次运行引导状态 ──
  let onboarding = initialOnboarding

  // ── 串行队列：配置写入不能并发（patch 整段替换）──
  let promptWriteQueue = Promise.resolve()
  let presetWriteQueue = Promise.resolve()

  return {
    config,
    paths,

    // 服务句柄
    getSessions: () => sessions,
    setSessions: (value) => { sessions = value ?? null },
    getSessionQuery: () => sessionQuery,
    setSessionQuery: (value) => { sessionQuery = value ?? null },
    getConnection: () => connection,
    setConnection: (value) => { connection = value ?? null },
    getConfigEditor: () => configEditor,
    setConfigEditor: (value) => { configEditor = value ?? null },
    getSessionProjections: () => sessionProjections,
    setSessionProjections: (value) => { sessionProjections = value ?? null },
    getSkills: () => skills,
    setSkills: (value) => { skills = value ?? null },
    isWebServerPresent: () => webServerPresent,
    markWebServerPresent: () => { webServerPresent = true },
    setWebServerPresent: (value) => { webServerPresent = value === true },

    // 状态缓存
    getStatusRevision: () => statusRevision,
    bumpStatusRevision: () => { statusRevision += 1 },
    readStatusCache: () => statusCache,
    writeStatusCache: (entry) => { statusCache = entry },

    // 运行时提示词/工具
    getPromptOverrides: () => promptOverrides,
    setPromptOverrides: (value) => { promptOverrides = { ...(value || {}) } },
    getExtraPrompts: () => extraPrompts,
    setExtraPrompts: (value) => { extraPrompts = { ...(value || {}) } },
    getExtraPromptPlacements: () => extraPromptPlacements,
    setExtraPromptPlacements: (value) => { extraPromptPlacements = { ...(value || {}) } },
    getDisabledTools: () => disabledTools,
    setDisabledTools: (value) => { disabledTools = Array.isArray(value) ? [...value] : [] },

    // 首次运行引导
    getOnboarding: () => onboarding,
    setOnboarding: (value) => { onboarding = value ?? null },

    // 串行写入队列：返回该次任务的结果，失败不影响后续任务
    enqueuePromptWrite: (task) => {
      const run = promptWriteQueue.then(task, task)
      promptWriteQueue = run.catch(() => {})
      return run
    },
    enqueuePresetWrite: (task) => {
      const run = presetWriteQueue.then(task, task)
      presetWriteQueue = run.catch(() => {})
      return run
    },
  }
}
