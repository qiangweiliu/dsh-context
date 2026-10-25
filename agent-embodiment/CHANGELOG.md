# Changelog

格式参考 Keep a Changelog；版本遵循 SemVer。DSH 兼容版本写在每个条目的 Compatibility 下。

## [0.24.0] - 2026-10-25

### Added

- 首次运行设置卡：确认插件预算、选择压缩策略、显式授权是否写入控制行；可以跳过，预算与策略之后仍可修改。
- 健康检查（控制行 / 可写入配置 / 预算已确认 / 已有测量），控制行缺失且可写时提供一键修复。
- 面板提醒条与 dock `⚠`：上下文达到警告/超限线、控制行未挂载、最近一次压缩失败；可在设置中关闭。
- 可执行洞察卡：工具定义占比、从未使用的工具、单会话反复压缩、压缩失败、未知模型价格、费用异常会话，每条可跳到对应位置。
- 压缩节省估算：按成功压缩的 `before - after` 汇总减少 tokens，并按 V4.1 Flash 输入价折算，明确标注口径。
- 会话对比（并排比较两个会话）与会话按最近活动 / tokens / 费用排序；费用最高会话高亮。
- 设置页模型价格编辑器：增删自定义 `match` 正则与 input/cacheRead/cacheWrite/output 行。
- 数据管理：按当前扫描范围导出 JSON / CSV，分别清空压缩日志、会话开关或两者；清空为两步确认。
- 提示词变更预览与增减 token 估算；工具行显示禁用后影响；保存无变化时按钮禁用。
- 新路由：`/status/insights`、`/status/onboarding`、`/status/export`、`/status/data/reset`。
- `insights.js` 纯规则引擎与 12 条单测；`metrics.js` 增加工具调用计数与 `estimateInputCost`。

### Changed

- 默认触发线从 `1` 改为 `0.9`：`balanced` preset 现在也是 0.9 触发 / 0.6 目标 / 保留 25%，不再等到窗口打满才压缩。
- `autoMountControl` 默认改为 `false`：首次运行必须由用户显式同意，插件不再静默改写 agent preset。
- 左侧导航 `embody` 重命名为 `Context` / `上下文`；Agent 从顶层 tab 移入设置 → Labs，面板固定为概览 / 趋势 / 事件 / 设置四个 tab。
- 跨会话分析显示“已扫描 / 总会话 / 上限”，不再把 `analyticsLimit` 截断后的结果当成全量。
- 概览去掉与页头/dock 重复的上下文大卡、与每日图重复的活跃度热力图，以及重复的费用 KPI；只保留 KPI 带、计费卡、每日图、最近会话。
- 页头合并为“会话 + 已用/剩余（或累计）+ 请求 + 费用”一行，并复用分段构成条；空会话不再显示四个 0% 构成。
- 会话卡从嵌套 button 改为可点击卡片 + 独立“打开会话”按钮。
- 设置页移除重复的“压缩记录”折叠块，压缩/注入历史统一到“事件”页。
- 版本升到 `0.24.0`。

### Fixed

- 会话列表不再依赖 `sessionQuery.listSessions()` / `sessions.list()` 的隐式顺序：显式按活动时间倒序后再取“最近 N 个”/latest。
- 自动挂载只写已知 preset id；找不到标准 preset 时只告警，不再猜一个任意 preset；重新启用时保留控制行原有 `mode` / `cooldownMs` / `maxAttempts` / `keepTokens`。
- 全局工具 toggle / “恢复全部”现在同步 `setGlobalDisabledTools`，重置后控制半侧不再沿用旧的全局禁用。
- 脚手架拒绝任意盘符根和 Windows `SystemRoot` / `ProgramFiles` / `ProgramData` 等系统目录。
- “恢复全部”同时清除会话提示词文本覆盖。
- 页头与会话卡的费用统一标注为“费用（估）”。
- 会话切换时清空上一会话的 `selected` 历史选择，趋势/详情不再停留在旧会话。
- `useLive` 在 path 变化时立即清空旧 payload，并用请求路径守卫丢弃迟到的旧响应；dock 同样按 sessionId 守卫。
- 补上 `sessions` 服务晚注入时的订阅；头部请求数只在 detail 属于当前会话时使用。
- 会话级提示词编辑草稿、展开态和确认态在切换会话时重置，避免把 A 会话的编辑带到 B 会话。
- “打开会话”优先调用官方 `uiWorkspace.openSession`，并补 `role=treeitem` 侧栏回退。
- 提醒条使用 `--dsw-alias-state-warn-primary`，修复无效 token 导致的不可见。

### Tests

- `static 95/95`、`metrics 35/35`、`state 18/18`、`scaffold 146/146`、`insights 12/12`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`。
- 新增静态断言：会话切换丢弃旧响应、清空历史选择、概览去重、`uiWorkspace.openSession`、会话排序、自动挂载目标、全局工具同步、Windows 路径、费用标签与“恢复全部”文案。
- `state.mjs` 覆盖 `clearSessionToggles` 同时清工具/提示词开关和会话提示词文本；`metrics.mjs` 覆盖工具调用计数与输入费用估算。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`（headless + Web 实测；Desktop 未单独验收）。

## [0.23.0] - 2026-10-24

### Added

- `compressionStrategy` preset：`conservative`（0.9 / 0.7 / 保留 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）；显式 `triggerAt` / `targetAt` / `keepTokens` 优先。
- 设置页增加压缩策略选择；切换策略会同步触发/目标比例。
- `analyticsLimit` 配置（1..200，默认 40），`?limit=` 仍可临时覆盖。
- 控制行未挂载时，工具/提示词修改会显示提示并拒绝执行。
- 计费按 DeepSeek 官方人民币峰谷价换算：V4.1 Flash / V4 Pro 的缓存命中、未命中、输出分开计价，每条请求按北京时间判定高峰/空闲。
- 概览新增计费卡；页头、会话卡、趋势卡与 tooltip 显示人民币费用。
- 静态测试新增压缩策略/control 未挂载提示/dock 已用百分比/趋势图与头部摘要/计费断言。

### Changed

- 版本升到 `0.23.0`。
- 底部 dock 改为跟随内置 ContextMeter 的读法：环形 + “插件上下文已用”百分比（分母仍是插件预算）；弹层显示已用/上限/剩余。
- 面板头部增加会话/预算/已用/剩余/请求数摘要与使用率条；趋势图补纵轴刻度、预算线、输入/输出配色和请求序号，替换原有的黑柱与 T 轮次标签。
- 费用从“只对旧模型按全天同价”改为官方峰谷价逐条估算，概览 KPI 与新增计费卡都读 `kpi.cost/costParts`；自定义 `modelPricing` 仍按全天同价。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`；`0.2.1-rc.3` 已完成 headless + Web 实测并加入矩阵，Desktop 未验收。

## [0.22.0] - 2026-10-24

### Changed

- 底部 token 指示器只显示“插件上下文”上限，不再重复官方 ContextMeter 的用量/构成。
- 脚手架定位改为 experimental 可选；`sense-environment` / `verify-change` 改为 `processSkills: true`（CLI `--process-skills`、面板 checkbox）才生成，默认只生成角色/delegation skill。
- 4 个依赖外部 MCP/知识库的模板标记为 `experimental`。
- 成本估算支持 `modelPricing` 用户价格表。
- `autoMountControl` 写入 preset 后回读校验，失败写 warning。

### Removed

- 生成的 `sense_environment` 工具与 `tool-catalog` skill。
- 底部指示器中重复的圆环/百分比/构成展示。

### Security

- 所有 HTTP 路由统一经过 `ctx.connection.requestRejection`；POST 只接受 `application/json`。
- scaffold `targetDir` 拒绝文件系统根、home 及其祖先、系统目录、`$DSH_HOME` 与常见凭据目录。

### Tests

- `static 77/77`、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 66/66`、`prompt-state 11/11`。
- Tier B 50 题四组对照与 scaffold 降本复核见仓库 `eval/deep/RESULTS.md`。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`（已实测）；`0.2.1-rc.3` 未验证。

## [0.21.0] - 2026-10-22

### Changed

- 统一命名：市场标题 `Agent Embodiment` / `智能体具身`，包名/目录 `agent-embodiment`，命令短品牌 `/embody`。
- 新增 Agent 脚手架（6 个模板）与面板 Agent tab。
- 旧命令 `/ctx`、`/ctx-compact` 保留为兼容别名；旧状态目录自动迁移。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`。
