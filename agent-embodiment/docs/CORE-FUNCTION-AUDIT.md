# 核心功能冲突与实现一致性审计

日期：2026-10-25  
版本：`agent-embodiment@0.23.0`  
范围：`index.js`、`control.js`、`state.js`、`metrics.js`、`scaffold.js`、`client.js` 及对应文档/测试。

## 0. 结论摘要

- **没有发现会让插件整体失效的 P0 问题**；当前 `static 89/89`、`metrics 31/31`、`state 16/16`、`scaffold 146/146` 仍通过。
- 插件的主体实现是“在 DSH 原生 tokenMeter / compaction / system-prompt / tools 之上做观测和控制”，**没有另造压缩模型或 tokenizer**，这一点与 README 的 native-first 定位基本一致。
- 但有 **4 个 P1 级一致性问题**，会让“最近会话”“控制行只影响当前 preset”“重置后真正解除限制”“脚手架只写工作区”这些核心承诺在特定条件下失真：
  1. 跨会话分析对 `listSessions()` 的顺序做隐式假设；
  2. 自动挂载控制行会选“任意一个带 plugins 的 preset”，并可能重置该行配置；
  3. 全局工具“恢复全部”只改运行时副本/配置文件，没有同步共享状态；
  4. Windows 下脚手架的系统目录/盘符根保护不完整。
- 另有若干 P2 级重复职责、跨 profile 状态、计费标签和文档不一致；不影响主流程，但会造成“看到的状态”和“实际生效”不一致。

## 1. 核心功能定义

按 README、package 描述和实际代码，核心功能可以归纳为：

| 编号 | 核心功能 | 用户承诺 | 主要实现 |
| --- | --- | --- | --- |
| F1 | 当前会话上下文观测 | 看到已用/预算/剩余/构成；不改变模型窗口 | `index.js` live/status + `tokenMeter`；`client.js` header/dock |
| F2 | 跨会话用量分析 | 最近若干会话的 tokens、请求、成本、日趋势 | `sessionQuery` + `metrics.js` + `/status/analytics` |
| F3 | 会话级预算与压缩 | 预算、触发线、目标线、会话覆盖、手动压缩 | `state.js` budgetFor + `control.js` compaction |
| F4 | 提示词控制 | 覆盖/新增/禁用 section；追加到用户消息；可见、不重写历史 | `control.js` assemble/pre-step + `index.js` config 写入 |
| F5 | 工具控制 | 全局/会话级禁用工具，实际请求生效 | `index.js` 全局 `tools.restrict` + `control.js` `syncGates` |
| F6 | 成本估算 | 官方峰谷价、按模型、未知模型不伪造 | `metrics.js` pricing/cost |
| F7 | Agent 脚手架 | 生成可安装 preset/skills/MCP/eval 起点，不自动切默认 preset | `scaffold.js` + `/status/scaffold/*` |
| F8 | 本地控制面 | 写入有备份、HTTP 有认证、路径有限制 | `index.js` authed/configEditor/scaffold guard |

## 2. 核心功能之间的冲突

这些是产品层面的张力，不一定是 bug；关键是是否被显式处理。

### 2.1 观测者 vs 控制者

F1/F2 要求尽量“只读、可比、稳定”；F3/F4/F5 会改变请求、提示词和工具。  
**现状**：默认 `autoMountControl: true`，安装后插件会主动往 agent preset 写控制行；这不是纯观测行为。  
**判断**：属于有意的产品选择，但“监控插件”标签会误导；控制卡和 `autoMountControl` 开关缓解了冲突。

### 2.2 DSH 原生上下文 vs 插件预算

DSH 原生 ContextMeter 用模型窗口；插件的 header/dock 用 `contextWindowTokens`（默认 128000），两个百分比可以完全不同。  
**现状**：README/LIMITATIONS 已说明“插件预算，不是模型窗口”。  
**判断**：可接受，但必须在所有百分比旁标明分母，否则用户会认为其中一个是错的。

### 2.3 DSH 原生压缩 vs 插件压缩编排

README 声称不重复实现引擎；`control.js` 确实调用官方 `compactIfNeeded`，但在 `idle` 模式下还会自己选择前缀并调用 `compactRegion` 兜底。  
**现状**：这是编排而不是重新实现压缩模型，但会改变原生压缩的时机/范围。  
**判断**：合理但需要明确“插件可能比 DSH 更早压缩”，并与 `triggerAt` 的预算口径一起展示。

### 2.4 全局作用域 vs 会话作用域

- 全局 `disabledTools` 由宿主半侧应用；会话禁用由 `control.js` 合并后按 agent 应用。
- 全局 `promptOverrides` / `extraPrompts` 是持久配置；会话提示词覆盖是 `session-toggles.json` 中的另一层。
- 优先级大致是“会话覆盖 > 全局 > 原文”，工具是“全局 ∪ 会话禁用”。

**风险**：两层状态各自有副本，UI 同时显示全局开关和会话开关；一旦某一层没有同步，用户会看到“已关闭但实际仍生效”。

### 2.5 跨会话分析 vs 性能/隐私

默认只扫描 `analyticsLimit=40` 个会话，且读本地会话日志。不是全量统计，这是有意的性能边界；UI 需要持续显示 coverage，否则“会话数/趋势”会被当成全量。

### 2.6 成本估算 vs 实际账单

费用是事件日志回放 + 官方价目估算，不含 Search/Fetch，法定节假日不扣除；不是账户账单。  
**现状**：计费卡有“估算”，但 header 和会话卡只写“费用”。  
**判断**：需要在所有费用入口统一标注“估算”，否则会被当成实际扣费。

### 2.7 脚手架 vs 运行时控制

脚手架生成的 preset 复用 `agent-embodiment/control`；它和主插件自动挂载的 `preset-standard` 控制行是两个 preset 里的同一插件。  
**风险**：多个 preset 同时存在时，自动挂载目标选择不当会把控制行写到非当前 preset；生成器 README 里“必须设为默认 preset”的测试说明也会让人误以为插件会自动切换。

## 3. 实现审计发现

### P1-1 跨会话分析的“最近 N 个”依赖未声明顺序

**证据**：

- `index.js` `analyticsHandler`：`const picked = list.slice(0, limit)`（`index.js:1029`），没有按 `lastActivityAt`/`createdAt` 排序。
- 另一个入口 `latestSession()` 对 `sessions.list()` 取 `all[all.length - 1]`（`index.js:1248-1251`），也没有显式排序。
- `/live` 的 fallback 同样取 `sessions.list()` 的最后一个（`index.js:782-788`）。
- DSH 官方的 `ApiSessionList.list()` 在拿到原始 `sessionQuery.listSessions()` 记录后，会显式 `items.sort((left, right) => right.updatedAt - left.updatedAt)`（`dsh-api-session-controller/lib/types/list.js:112-145`），说明 provider 的返回顺序不是插件可以依赖的契约。

**问题**：插件直接把 provider 顺序当作“最近优先”，但官方适配层自己都要重新排序。`sessionQuery.listSessions()` 和 `sessions.list()` 又是两个不同 API，不能共享同一个方向假设。  
**影响**：如果 `listSessions()` 返回最旧在前，`slice(0, limit)` 会扫描**最旧的 40 个**会话，而 UI 标题写“最近会话”；趋势/日桶/成本会偏离最近使用情况。`latestSession()` 的 `at(-1)` 也可能取到错误会话。  
**结论**：核心 F2 的“最近 N 个”目前依赖未声明顺序；应以 `lastActivityAt`/`updatedAt` 显式降序排序后再取前 N/第 0 个。  
**建议**：在插件侧统一 `sort`，不要依赖 provider 的隐式顺序；增加一个「乱序 provider」单测。

### P1-2 自动挂载可能写入非目标 preset，并重置控制行配置

**证据**：

- `findPresetEntry()` 先找已知 id，找不到就返回任意 `entry.options.config.plugins` 是数组的 entry（`index.js:818-837`）。
- `autoMountControl()` 使用该 entry 写入（`index.js:904-915`）。
- `CONTROL_ROW` 固定为 `config: { mode: 'idle' }`（`index.js:841`）；`mutatePreset()` 每次 enable 都 push 这个固定对象（`index.js:872-890`）。
- 文档却写“启动时检查 `preset-standard`”（`docs/IMPLEMENTATION.md:160`）。

**问题**：

1. 有多个 preset（尤其是脚手架生成的 `preset-<slug>`）时，`findPresetEntry()` 可能命中非当前/非标准 preset；
2. 用户自定义过控制行 `mode/cooldownMs/maxAttempts/keepTokens` 后，先停用再启用会恢复成 `mode: idle` 的默认配置。

**影响**：核心 F3“控制行只影响当前 agent preset”和“用户配置可保留”不成立；在 Desktop/多 preset 环境中很难排查。  
**建议**：只修改 `preset-standard` 或显式配置的 preset id；写入前保留已有控制行的 config，只补缺失字段；如果找不到标准 preset，应在 UI 报错而不是随便选一个。

### P1-3 “恢复全部”没有同步全局工具共享状态

**证据**：

- `inventoryResetHandler` 在 `layer === 'global' || 'all'` 时设置 `runtimeDisabledTools = []` 并写 `disabledTools: []`（`index.js:1360-1378`）。
- 但没有调用 `setGlobalDisabledTools([])`；共享状态只在 `apply()` 时由 `setGlobalDisabledTools(config.disabledTools)` 写入（`index.js:422`）。
- `control.js` 的 `syncGates` 读取的是 `getGlobalDisabledTools()`（`control.js:174`），不是 `runtimeDisabledTools`。

**影响**：重置后面板可能显示“已清空”，但控制半侧的 gate 仍带旧全局禁用，直到配置文件重挂/插件重载；如果 `configEditor.edit` 失败，旧限制会一直保留。  
**建议**：在重置/全局 toggle 成功后立即调用 `setGlobalDisabledTools(next)`，并让 `runtimeDisabledTools` 只作为 UI 快照。

### P1-4 Windows 下脚手架路径保护不完整

**证据**：`protectedScaffoldPath()`（`index.js:1559-1574`）的 `systemPrefixes` 只有 `/etc`、`/usr`、`/var` 等 Unix 路径；`root === resolve('/')` 只覆盖当前盘符根。  
**问题**：在 Windows 上：

- `C:\Windows`、`C:\Program Files`、`C:\ProgramData` 不在保护列表；
- `D:\` 这类非当前盘符根不会被 `root === resolve('/')` 命中；
- 仅 home 祖先和 `$DSH_HOME` 被拦截。

**影响**：与 LIMITATIONS 的“拒绝系统目录/文件系统根”承诺不一致；用户误填 `D:\` 时可能把脚手架文件写到盘符根。  
**建议**：用 `path.parse(root).root` 判断任意盘符根；加入 `process.env.SystemRoot`、`ProgramFiles`、`ProgramData`、`Windows` 等平台路径；或者更严格地要求目标在用户可见工作区/当前 cwd 下。

### P2-1 控制行的 `maxContextTokens` 实际被宿主默认值遮蔽

**证据**：

- 宿主 `apply()` 总是 `setDefaultBudget(config.contextWindowTokens)`（`index.js:415`），默认 128000（`index.js:100`）。
- `budgetFor()` 的顺序是“会话覆盖 > global default > fallback”（`state.js:130-135`）。
- `control.js` 用 `budgetFor(sessionId, config.maxContextTokens || FALLBACK_BUDGET)`（`control.js:339`），所以只有宿主未设置 global 时 control 的 `maxContextTokens` 才生效。

**判断**：注释已说明这是 fallback，但在同一产品里保留两套 budget 配置容易误配；用户改 control 行的 `maxContextTokens` 通常不会看到效果。  
**建议**：删除 control 的预算配置，或让 UI 明确只暴露宿主 `contextWindowTokens`；保留 fallback 时在文档中写清楚优先级。

### P2-2 全局工具禁用被实现了两次

**证据**：

- `index.js` 的 `ctx.inject(['tools'])` 执行全局 `tools.restrict({ deny })`（`index.js:1223-1245`）。
- `control.js` 的 `syncGates()` 又把 `getGlobalDisabledTools()` 与会话禁用合并，再执行 `agent.ctx.tools.restrict({ deny })`（`control.js:166-181`）。

**判断**：功能上冗余，且两个 restrict 的叠加语义依赖 DSH 实现（是并集、覆盖还是最近调用生效）；这会让“全局工具开关”难以推理。  
**建议**：只保留一层职责：要么宿主负责全局、control 只加会话项；要么 control 全权负责，宿主不再 restrict。并在测试中固定叠加语义。

### P2-3 会话开关和压缩日志是跨 profile 共享的

**证据**：状态目录固定为 `~/.dsh/agent-embodiment`（`index.js:430`），`session-toggles.json` / `compaction-log.jsonl` 不按 profile 分目录。  
**影响**：同一台机器上 `desktop`、`web`、测试 profile 会共享会话级开关和压缩历史；事件页可能显示另一个 profile 的压缩记录。  
**判断**：文档说“跨 profile 共享”，但对“当前会话控制”来说容易造成误解；session id 通常不会冲突，但历史视图会混。  
**建议**：至少给压缩日志加 profile 标识/过滤，或把状态目录移到 profile 下。

### P2-4 重置不清会话提示词文本覆盖

**证据**：`clearSessionToggles()` 只删 `sessionTools` / `sessionPrompts`（`state.js:277-280`）；`sessionPromptText` 由独立 API 清除（`state.js:393-409`），但 `snapshotSessionToggles()` 会把 `promptText` 一起持久化（`state.js:371-376`）。  
**影响**：`/inventory/reset?layer=session` 后，提示词文本覆盖仍存在；如果用户在 UI 里把“重置”理解为“本会话全部恢复”，会看到提示词仍被改过。  
**建议**：明确 UI 文案为“清空开关（不含文本覆盖）”，或在 `clearSessionToggles` 中一并清 `sessionPromptText`。

### P2-5 成本标签不统一

**证据**：计费卡标题是“计费（估算）”（`client.js:472`），header 使用“费用”（`client.js:473`、`client.js:3064`），会话卡也直接显示金额。  
**影响**：用户可能把 header/session 金额当成实际扣费；尤其 header 是当前会话累计估算，计费卡是区间估算。  
**建议**：header 用“费用（估）”，会话卡 tooltip 或副标题标注“估算”；所有成本入口共享同一标签 key。

### P2-6 文档和测试的边界滞后

- `docs/IMPLEMENTATION.md:49` 的路由已修正为 `/api/agent-embodiment/status/config`；其余路由仍建议统一由 `STATUS_PATH` 生成。
- `docs/IMPLEMENTATION.md:160` 说自动挂载 `preset-standard`，实现可能选任意 preset（见 P1-2）。
- `scaffold.js:567` / `:720` 生成的说明写“必须把 preset 设为默认”，而 `scaffold.js:734` 和 README 又写“不自动切换默认 preset”；用户需要手动选择，指令前后不一致。
- 静态测试主要是源码字符串断言；P1-1/P1-2/P1-3 这类顺序、preset 选择、共享状态同步没有测试覆盖；UI 会话切换此前也主要靠人工验证。

**建议**：给顺序、自动挂载目标、重置共享状态加单元/集成断言；文档中的路径统一为 `STATUS_PATH` 常量。

## 4. 逐模块结论

| 模块 | 核心职责 | 审计结论 |
| --- | --- | --- |
| `index.js` | 命令、状态路由、配置写入、自动挂载、全局工具限制、日志落盘 | 主路径可用；P1-1/P1-2/P1-3/P1-4 均在此或涉及此处，需修正边界 |
| `control.js` | prompt 装配、工具 gate、自动/手动压缩、用户消息追加 | 与 native seam 基本一致；P2-1/P2-2 是重复配置/重复限制 |
| `state.js` | 预算、会话开关、inventory、压缩日志、全局配置镜像 | 结构清晰；P2-3/P2-4 的持久化边界需明确 |
| `metrics.js` | 事件折叠、成本、日桶、趋势 | 纯函数、测试较完整；成本假设已在 LIMITATIONS 说明 |
| `scaffold.js` | 生成 preset/skills/MCP/eval 文件 | 生成内容自洽；路径保护和“默认 preset”说明需修正 |
| `client.js` | 面板、header、dock、设置、会话切换 | 会话切换隔离已补齐；P2-5 成本标签需统一 |
| 测试 | 回归保障 | 89/31/16/146 通过；缺少 P1 边界的行为测试 |

## 5. 建议处理顺序

1. **P1-1**：显式排序会话，修“最近 N 个”与 `/live`/inventory 的 latest 口径。
2. **P1-2**：限制自动挂载目标，保留已有控制行 config；多 preset 时不允许猜测。
3. **P1-3**：重置/全局 toggle 同步 `setGlobalDisabledTools`，加状态断言。
4. **P1-4**：补齐 Windows 系统路径/盘符根保护，并加路径单测。
5. **P2**：收敛重复的 budget/tool 职责，统一成本标签，明确 profile 隔离和重置语义，补边界测试与文档路径。

## 6. 未覆盖/未验证

- 本轮是静态代码审计 + 现有测试基线复核，没有重新做 Desktop/Web 端到端点击；`sessionQuery.listSessions()` 的实际排序未在当前 profile 上再次实测。
- 未检查 DSH 原生 `tools.restrict` 的内部叠加语义；P2-2 的“覆盖/并集”结论需要运行时验证。
- 未做独立安全审计；P1-4 是路径边界问题，不等同于完整安全结论。
