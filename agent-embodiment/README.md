# Agent Embodiment

在 DeepSeek Harness（DSH）原生上下文管理之上，提供跨会话用量与费用分析、压缩洞察与节省估算、会话级预算/提示词/工具控制，以及可选的 Agent 脚手架。

> **与 DSH 原生能力的关系**：token 计量、自动压缩、系统提示词装配、文件/命令/Web/子 agent 等由 DSH 本体提供；本插件不重复实现这些引擎，而是复用官方 seam，补上可观测性与用户控制。单轮任务能力不会因为安装本插件而提升。

包名：`agent-embodiment` · 市场标题：`Agent Embodiment` / `智能体具身` · 当前版本：`0.26.0`

## 安装 / 升级 / 回滚

> npm 包发布前，请用「从源码安装」；市场（awesome-dsh-plugin）条目已收录，安装时选中 `agent-embodiment` 即可。

从源码安装（推荐，当前可用）：

```sh
git clone https://github.com/qiangweiliu/dsh-context.git
cd dsh-context
dsh plugin --profile web add "$PWD/agent-embodiment"     # Desktop 用 --profile desktop
```

从 npm 安装（发布后）：

```sh
dsh plugin --profile web add agent-embodiment
dsh plugin --profile web update agent-embodiment@latest
```

升级与回滚：

- 升级到新版本（替换已安装包）后需要重启 DSH 进程；首次安装/启停由 HMR 热生效。
- 回滚：`dsh plugin --profile web add agent-embodiment@<旧版本>`；源码安装则重新 `add` 旧路径。
- 卸载后如 profile 里仍残留 preset 行，用 `node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>` 清理。

## 安装后何时生效

- DSH 默认启用 HMR：首次安装、启用/停用会在数秒内自动出现，**不需要重启 DSH**。
- Web（`dsh 0.2.0-rc.2`）与 Desktop（`0.2.1-rc.2`）均已实测：运行中 add/remove 后侧栏与面板即时出现/消失。
- 如果页面仍显示旧界面，Web 刷新一次页面即可。
- 安装时确认 `--profile` 与运行实例一致（Desktop 是 `desktop`，WSL web 通常是 `web`）；DSH `0.2.1-rc.1` 不在支持矩阵内。
- 只有**替换已安装包（升级到新版本）**时，DSH 才要求重启进程；面板检测到宿主/客户端版本不一致时也会提示“刷新页面”。

## 首次运行：先确认预算，再授权控制行

0.24.0 起，插件**不再默认改写 agent preset**。首次打开概览页会出现一张三步设置卡：

1. 确认插件预算（用于百分比与压缩，不是模型窗口）；
2. 选择压缩策略；
3. **显式勾选**是否允许把控制行写入 agent preset。不勾选时提示词/工具修改仍只读，需要自己挂载。

可以点“稍后”跳过。预算和策略之后仍可在设置里修改；如果控制行没挂上，设置页的“健康状况”卡会指出缺哪一项，并在可自动修复时提供一键修复。自动挂载只写已知 preset id，并保留该控制行已有的 `mode` / `cooldownMs` / `maxAttempts` / `keepTokens`，不会替你切换默认 preset。

## 功能

### 1. 控制上下文长度

- 设置当前会话的上下文上限和压缩触发线。
- 压缩策略 preset：`conservative`（0.9 触发 / 0.7 目标 / 保留 35%）、`balanced`（0.9 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）；手动填写 `triggerAt` / `targetAt` / `keepTokens` 时以手动值为准。
- 默认 `triggerAt` 为 **0.9**：到预算 90% 就开始预压缩，而不是等到 100% 才触发。
- 达到触发线时自动压缩，减少后续请求的 token 消耗。
- 手动压缩当前会话（官方 `/compact` 也可用；本命令按插件预算重试）：

```text
/embody-compact
```

- 临时修改当前会话上限：

```text
/embody 200000
/embody reset
```

### 2. 监控上下文与成本

- 查看当前会话的上下文用量、剩余空间和占用比例。
- 查看提示词、工具定义、历史消息、本轮对话各占多少 token。
- 面板有 **概览、趋势、事件、设置** 四个视图；设置页底部是 **Labs**（原 Agent 脚手架入口），不再占顶层 tab。
- 头部合并为“会话 / 已用（或累计）/ 请求数 / 费用”一行摘要，下面复用分段构成条；趋势图带纵轴刻度、预算线、输入/输出配色和请求序号（#1…），悬停可看该次请求的 T 轮次、时间、用量与费用。
- 跨会话分析默认扫描 `analyticsLimit` 个会话（默认 40，最大 200）；请求里带 `?limit=` 可临时覆盖。界面会显示“已扫描 / 总会话 / 上限”，不把扫描结果伪装成全量。
- **压缩节省估算**：概览按成功压缩记录的 `before - after` 汇总减少的 tokens，并按 V4.1 Flash 输入价折算成人民币；这是“单次上下文减少”的口径，不是账单退款。
- **会话对比**：趋势页可选两个会话并排比较 tokens、请求数、费用与压缩次数；会话卡支持按最近活动 / tokens / 费用排序，并高亮费用最高的会话。
- **可执行洞察**：概览会给出最多 6 条确定性结论（工具定义占比过高、多个工具从未使用、单会话反复压缩、压缩失败、未知模型价格、费用异常会话），每条都能跳到对应设置/事件/趋势位置。没有数据时不会硬造结论。
- 输入框下方跟随内置 ContextMeter 的读法，用环形 + 百分比显示 **插件上下文已用比例**（分母是插件为本会话配置的上限，含会话级覆盖；点开可看已用/上限/剩余）。token 构成与模型窗口口径仍由 DSH 内置 ContextMeter 显示，不重复。
- 费用按 DeepSeek 官方人民币峰谷价逐条换算：V4.1 Flash 缓存命中 ¥0.02/¥0.04、未命中 ¥1/¥2、输出 ¥4/¥8（空闲/高峰，每百万 tokens；Pro 为 ¥0.15/¥0.30、¥4.5/¥9、¥13.5/¥27）。概览有计费卡拆分缓存命中/未命中/输出，页头、会话卡和趋势也显示费用；不含 Search/Fetch。
- 内置价目覆盖官方 V4.1 Flash / V4 Pro；设置页的“模型价格”卡可直接增删自定义行（`match` 正则 + input/cacheRead/cacheWrite/output，CNY / 1M tokens），自定义行按全天同价计算。
- 设置 → 上下文 → 余额胶囊可开启输入框下方的 DSH 余额显示（默认关闭，开启状态保存在本机，重启后保留）；展开可看充值/赠金分项、跳转充值页，账号接口失败时给出来源链接。
- **提醒条**：上下文达到警告/超限线、控制行未挂载或最近一次压缩失败时，面板顶部显示提醒条，dock 显示 `⚠`；可在设置 → 数据管理里关闭提醒。

### 3. 修改提示词

- 查看当前实际加载的提示词 section 和 token 占用。
- 覆盖已有提示词，或为当前会话单独修改。
- 按会话关闭不需要的提示词。
- 新增一条独立提示词，不覆盖原有提示词。
- 编辑提示词时显示**变更预览**（`data-embodiment-prompt-diff`）和增减 token；内容没变时保存按钮禁用，避免无意义写入。
- 工具行会显示禁用后的影响（调用的工具定义 token、可能丢失的能力）；禁用前有明确确认，不会静默生效。
- 内置一条「方法论（通用）」模板：点一下就把草稿填进名称/内容/放置位置，可改再存。文本走通用能力，不特化某类任务：
  - 先声明用哪种推理结构，而不是套固定步骤（Self-Discover，MATH 上比 CoT 最高 +32%）；
  - 中间推理只写要点（Chain of Draft，token 可降到 7.6%、精度不降）；
  - 结论必须有本会话工具输出或用户消息作为证据（ReAct）；
  - 动手前问“什么能证明我错”、交卷前换路径复核（Popper 可反驳性、CoVe/Reflexion）；
  - 先定义“怎样算做完”、停手条件、置信度校准（Polya、Dewey、贝叶斯）。
  - 实测（`eval/REPORT.md` 实验 7）：比上一版严格判分 +8pp、MATH +2pp、MATH 耗时降 38%。
  - 模板**不默认注入**，不点就不会多花 token，也不会破坏提示词缓存（文本固定，无时间戳/会话 id）。
- 新增时选择放置位置：
  - **每次用户提问末尾**（默认）：新提示词会追加到每一条新的用户消息末尾，下一轮、再下一轮都会继续追加；
  - **系统提示词**：作为 system section 插入，只在系统提示词部分生效。
- 追加到提问末尾的内容会成为用户消息的一部分，历史记录里可见；它不是隐藏指令，也不是“秘密注入”。
- 修改在之后的请求中生效；已有会话的旧提示词历史不会被删除，需要完全替换时请新建会话。

### 4. 数据管理

- 设置 → 数据管理可导出当前扫描范围为 **JSON / CSV**（`/status/export`），用于自己核算或备份。
- 可分别清空压缩日志、会话开关，或两者都清；清空只影响插件状态，不删除 profile 配置、不删除会话历史。
- 清空操作为两步确认，第一次点击只进入确认态。
- 工具/提示词开关是会话级的；全局工具禁用和全局提示词覆盖是持久配置，按“恢复全部”才会一起清空。

## Agent 脚手架（0.24.0 起降级为 Labs，experimental 可选）

把 AI 当思维核心、脚手架当“感官 + 手 + 反馈”的具身能力包。**默认不推荐作为首选能力**：实测它会让工具调用和输出变多，但没有稳定的准确率收益；需要流程提示时再显式开启 process skills。

- 入口在 **设置 → Labs**；也可以命令行生成：
  ```bash
  node scripts/agent-scaffold.mjs --template repo-coder --out /path/to/workspace --slug my-agent
  ```
- 模板：`repo-coder`、`web-researcher`；`ops-runbook`、`browser-operator`、`data-analyst`、`support-router` 标记为 **experimental**（依赖外部 MCP/知识库，尚未做任务验证）。
- 生成物：
  - `.dsh/scaffolds/<slug>/`：可安装的 DSH bundle，insert 一个 agent preset；
  - `.agents/skills/<slug>-*/SKILL.md`：角色 skill 与 delegation skill；`sense-environment`、`verify-change` 是过程 skill，默认不生成，需加 `--process-skills`（面板勾选 “Include process skills”）；全部使用 DSH 原生工具，不注册自造工具；
  - `SENSES.md` / `HANDS.md` / `LOOP.md` / `AGENTS.snippet.md` / `evals/`；
  - `evals/cases.jsonl` + `evals/run.mjs`：按 case 调用 `dsh headless` 记录 transcript 的 runner（不自动判分）。
- 预览与生成走宿主路由：`/api/agent-embodiment/status/scaffold/{templates,preview,generate}`。
- 面板支持可选 MCP JSON（stdio / streamable-http；secret 用 `${ENV_VAR}`）和 AGENTS.md 带标记合并。
- 生成的 preset 复用 `agent-embodiment/control` 做上下文压缩；需要在同一 profile 安装本插件。
- 子 agent 只使用跨版本字段（`provider`/`toolName`/`backgroundMode`/`maxDepth`）；角色说明在生成的 `delegate-<role>` skill。DSH 0.2.1 若需子 agent 工具隔离/独立 persona，请另建 Agent Preset。
- 不会替用户切换默认 preset；安装后在 Settings → Agent presets 选择。

## 入口

可以从三个地方打开面板：

- 左侧导航的 `Context` / `上下文`；
- 设置 → 上下文；
- 输入框下方的 `Context` 指示器。

也可以在会话中直接使用 `/embody` 查看当前上下文。`/ctx`、`/ctx-compact` 保留为兼容别名，计划在下一个大版本移除；新脚本请使用 `/embody`、`/embody-compact`（或官方 `/compact`）。

## 更多文档

- 实现细节：[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- 核心功能冲突与实现审计：[docs/CORE-FUNCTION-AUDIT.md](docs/CORE-FUNCTION-AUDIT.md)
- 约束与已知限制：[docs/LIMITATIONS.md](docs/LIMITATIONS.md)
- 权限说明：[PERMISSIONS.md](PERMISSIONS.md)
- 验证证据：[docs/EVIDENCE.md](docs/EVIDENCE.md)

## 许可

MIT
