# 实现说明

本文描述 `agent-embodiment` 的内部结构、集成点和验证方式。面向用户的功能说明见 [README.md](../README.md)；约束与已知限制见 [LIMITATIONS.md](LIMITATIONS.md)。

当前版本：`0.23.0`

## 1. 两个半侧

插件由两个 Cordis 插件组成：

| 文件 | 平面 | 作用 |
| --- | --- | --- |
| `index.js` | 宿主平面 | 读取 token 用量、注册 `/embody` 与状态路由、保存全局配置 |
| `control.js` | agent preset 内 | 执行自动压缩、工具/提示词开关、`/embody-compact` |
| `state.js` | 共享状态 | 两个半侧共享默认预算、会话覆盖、控制状态 |
| `client.js` | 浏览器平面 | 注册整页面板、设置分区、侧栏 `embody` 和 composer dock |
| `dsh.bundle.patch.yml` | bundle 层 | 向 profile boot graph 插入插件行 |
| `locale/{en,zh}.json` | 插件市场 | `meta.title` / `meta.description` |

`index.js` 不 import 任何 npm 包；`control.js` 也零 import，只依赖 Cordis 服务。

## 2. 宿主半侧

`index.js` 的 `Config` 使用手写 Standard Schema：

- `contextWindowTokens`
- `compressionStrategy`（conservative / balanced / aggressive）
- `analyticsLimit`（1..200，默认 40）
- `warnAt` / `errorAt`
- `triggerAt` / `targetAt`
- `keepTokens`
- `disabledTools`
- `promptOverrides`
- `extraPrompts`
- `extraPromptPlacements`
- `autoMountControl`
- `modelPricing`（用户价格表，补充/覆盖内置模型）

注册内容：

- `/embody`、`/embody <tokens>`、`/embody reset`；`/ctx` 为兼容别名；
- `GET /api/agent-embodiment/status`；
- `/status/live`、`/status/analytics`、`/status/session-detail`；
- `/status/inventory`；
- `/status/inventory/toggle`、`/status/inventory/reset`；
- `/status/inventory/prompt`、`/status/inventory/prompt/reset`；
- `/status/inventory/prompt/session`、`/status/inventory/prompt/session/reset`；
- `/status/inventory/extra-prompt`、`/status/inventory/extra-prompt/reset`；
- `POST /api/agent-embodiment/config`（经 `ctx.configEditor` 写入 profile patch）。

全局配置写入后会触发 Loader 重挂插件。写入对象是 profile 的插件 config 行，不直接改会话历史。

所有 HTTP 路由注册时统一套 `authed`：先调用 `ctx.connection.requestRejection`（Host/Origin + 浏览器/API 认证），拒绝时返回 401/403；没有 `connection` 服务（如 headless）时放行。POST 只接受 `application/json`，其他 content-type 返回 415。

## 3. 控制半侧

`control.js` 必须挂进 agent preset 的 compaction 组：

```yaml
- id: agent-embodiment-control
  name: 'agent-embodiment/control'
  config:
    mode: idle
```

原因：Web 形态下宿主平面的 `compaction-basic` / `command-compact` / `tool-result-pruner` 被 `dsh-web-app` 置为 disabled，真正运行的 `compaction` 服务位于 `preset-standard` 的 `cordis:group` 内，宿主上下文拿不到它。

默认 `mode: idle` 在 `agent/pre-step` 检查用量：

- 超过触发线时调用 `compactIfNeeded(agent, 'pressure')`；
- 未到目标线时对最小可压前缀调用 `compactRegion`；
- 最多 `maxAttempts` 轮；
- 预热压缩没有安全历史时静默跳过。

其他模式：

| `mode` | 行为 |
| --- | --- |
| `idle` | 默认；自动压缩并做范围压缩兜底 |
| `pre-step` | 只调 `compactIfNeeded`，不做范围兜底 |
| `notify` | 只测量写日志，不压缩 |
| `off` | 关闭控制 |

触发线 = 预算 × `triggerAt`；目标线 = 预算 × `targetAt`。`warnAt` / `errorAt` 只用于 UI 标记。

`compressionStrategy` 提供三档 preset：`conservative`（0.9 / 0.7 / keep 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）。只有在配置里没有显式写 `triggerAt` / `targetAt` / `keepTokens` 时，preset 才会填入默认；显式值优先。

## 4. 工具与提示词

每次装配时，`control.js` 在 `system-prompt/assemble` waterfall 中：

1. 读取会话级禁用列表、全局 `promptOverrides`、会话文本覆盖；
2. 重建 `result.sections`；
3. 把实际生效的 section 与 token 估算写入 inventory；
4. 记录工具清单。

会话级工具通过 `agent.ctx.tools.restrict({ deny })` 应用；提示词通过过滤 section 应用。

`extraPrompts` 的处理：

- 配置 key 为用户名称；
- 实际 section 名为 `agent-embodiment:extra:<name>`；
- `extraPromptPlacements[name] === 'user'` 时**不插入 system section**，而是在 `agent/pre-step` 中追加到本轮新用户消息末尾；
- 其余情况插入到 `harness:identity` 之后；
- 内容为空则跳过；
- 已存在同名 section 时不重复插入；
- 支持会话级禁用。

内置模板：`index.js` 的 `PROMPT_TEMPLATES`（当前一条 `method`）只作为草稿来源，
经 `GET /inventory` 的 `promptTemplates` 字段下发，面板「新增提示词 → 模板」一点填入
名称/内容/放置位置（`system`），仍走同一个 `POST /inventory/extra-prompt` 落盘。
模板文本必须稳定（不含时间戳、会话 id、随机量），否则每次请求都会 miss 提示词缓存；
`test/prompt-state.mjs` 里有对应断言。模板不默认注入。

实测（`eval/REPORT.md` 实验 6/7）：第一版方法论模板在 GSM8K 上真实正确率与不加提示词相同
（47/50），MATH L5 平均耗时从 13s 涨到 24s——只增加推理长度。按 Chain of Draft
（arXiv 2502.18600，短中间推理）与 Self-Discover（arXiv 2402.03620，先自选推理结构）
重写成 v2 后：严格判分 +8pp、MATH +2pp、MATH 耗时降 38%（14.9s）。所以保持"手动一键启用"，
不默认开，也不做成长篇清单。

`placement: user` 的追加 hook：

- 在 `agent/pre-step` 调用 `next()` 后取最终 decision；
- 只处理 `role === 'user'` 且 `source.kind === 'user'` 的消息；
- 把文本作为末尾 text block 追加到 content（不另建消息、不改历史）；
- 每一条新的用户消息都会独立追加，因此每个用户提问都会带上；
- 内容成为 `user/message` 的一部分并写入会话日志，UI 中可见；
- 会话级禁用后跳过。

inventory 属于进程内存，只反映最近一次装配；新会话需要先发一条消息。

### 计费估算（0.23.0）

`metrics.js` 的 `DEFAULT_MODEL_PRICING` 使用 2026-10-24 抓取的 DeepSeek 官方人民币价（CNY / 1M tokens）：

- V4.1 Flash：缓存命中 ¥0.02/¥0.04、未命中 ¥1/¥2、输出 ¥4/¥8（空闲/高峰）；
- V4 Pro：缓存命中 ¥0.15/¥0.30、未命中 ¥4.5/¥9、输出 ¥13.5/¥27。

`isPeakTime()` 按北京时间工作日 09:00–12:00、14:00–18:00 判定；每条 `assistant/message` / `compaction/summary` 用事件时间算 `costParts`（input=缓存未命中、cacheRead=命中、cacheWrite 按未命中价、output），再汇总到 `fold.cost`、`fold.costParts`、日桶和 `summarizeFolds().kpi.costParts`。状态接口下发 `pricing` 元数据（models、peakNow、source），面板的计费卡、KPI、页头、会话卡和趋势 tooltip 都读这份数据；`modelPricing` 自定义行仍按全天同价覆盖。

## 5. 配置写入与备份

全局配置、全局提示词、新增提示词都经 `ctx.configEditor` 写 profile `cordis.patch.yml`。

写操作前自动备份，备份位于：

```text
~/.dsh/agent-embodiment/backups/
```

面板「恢复全部」会清空：

- 会话开关；
- 全局工具禁用；
- 全局提示词覆盖；
- 新增提示词。

## 6. 自动挂载控制行

插件启动时检查 `preset-standard` 的 compaction 组；如果没有 `agent-embodiment/control` 行，就通过 `ctx.configEditor` 写入一行。

面板停用自动压缩时会：

- 移除 preset 行；
- 把 `autoMountControl: false` 写入会话开关状态文件；
- 此后启动不会自动加回。

启用时反向恢复。

注意：写入的是 `preset-standard` 的配置快照；DSH 升级 preset 后需要按新默认重新启用或手工同步。

## 7. 客户端

`client.js` 在 `apply(ctx)` 中注册：

- `sidebar.panellist`：左侧 `embody` 图标；
- `main`：整页「上下文监控」；
- `settings.section`：设置 → 上下文；
- `conversation.composer.dock`：输入框下方指示器，环形 + 插件预算已用百分比；弹层显示已用/上限/剩余。

面板头部常驻“会话/预算/已用/剩余/请求数/费用”摘要与使用率条；概览 KPI 下方有计费卡，按缓存命中/未命中/输出拆分 token 与人民币；趋势图用纵轴刻度 + 预算线 + 输入/输出色块，X 轴按请求序号 `#n` 标注，压缩点用橙色竖线标记，tooltip 含单次费用。

客户端只通过状态接口读取数据；新增提示词、全局配置等写入通过宿主路由完成。API 路径相对 `document.baseURI` 解析，兼容反向代理的路径前缀；`apply` 带 window 级幂等守卫，避免同一页面重复挂载出两套导航/设置/dock。

面板监听会话区域 DOM 变化，2 秒节流刷新；空闲时不轮询。

## 8. 安装与卸载内部行为

安装走 DSH 官方插件管理器：

```text
profile package.json dependencies
→ node_modules/agent-embodiment
→ dsh.profile.bundles 追加 agent-embodiment
→ Loader 读取 dsh.bundle.patch.yml
```

本地目录安装会记录为 `link:` 依赖。首次安装与启停由 DSH HMR 热生效：宿主半侧在数秒内挂载，Web 页面会跟随客户端模块图更新；页面没更新时刷新一次即可，不需要重启 DSH。Desktop 0.2.1-rc.2 也已实测：运行中 add/remove 后侧栏与面板即时出现/消失（`EVIDENCE.md` E17）。卸载会从 `dsh.profile.bundles` 移除并热卸载。**替换已安装包（升级版本）仍是例外**：DSH 缓存已挂载包的 manifest 与模块代际，官方要求重启进程。

自动挂载或全局配置写入会在 profile patch 中留下顶层插件行与 preset 行。单纯 `dsh plugin remove` 不会清理这些行；需要时使用仓库脚本：

```bash
node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>
```

WSL 安装脚本：

```bash
bash scripts/wsl-install.sh web
bash scripts/wsl-uninstall.sh web
```

Windows 卸载校验：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-uninstall.ps1 -Profile desktop -Clean
```

## 9. 测试

```powershell
npm test                      # static + metrics + state + scaffold（不依赖 DSH 运行时）
npm run test:integration      # prepare-deps + control + smoke + prompt-state（需要本机 app.asar）
node --check index.js
node --check control.js
node --check client.js
```

`test/prepare-deps.mjs` 默认读取本机 DSH 的 `app.asar`，可用 `DSH_ASAR` 环境变量指定其他路径。

当前结果：

```text
static       86/86
metrics      31/31
state        16/16
scaffold    146/146
control      54/54
smoke        72/72
prompt-state 11/11
```

UI 证据与历史版本验收见 [EVIDENCE.md](EVIDENCE.md)。

## 10. 兼容性

manifest 声明：

- Node `>=20`
- DSH `>=0.2.0-rc.2 <0.3.0 || 0.2.1-rc.2`
- profiles：`web`、`desktop`

已实测 WSL `dsh 0.2.0-rc.2` 和 Windows Desktop `0.2.1-rc.2`。其他版本保持 `unknown`。

## 11. Agent 脚手架（0.23.0，experimental 可选）

`scaffold.js` 是纯函数生成器（不读写磁盘、不 import npm 包），把 `EmbodimentSpec` 变成一份可安装的 Embodiment Pack：

- `.dsh/scaffolds/<slug>/package.json` + `dsh.bundle.patch.yml`：insert 一个 `@deepseek-ai/dsh-agent-preset` 行；
- `.dsh/scaffolds/<slug>/SENSES.md` / `HANDS.md` / `LOOP.md` / `AGENTS.snippet.md`；
- `.dsh/scaffolds/<slug>/skills/<skill>/SKILL.md`，同时复制到 `.agents/skills/<slug>-<skill>/SKILL.md`（`dsh-skill-filesystem` 扫描）；默认只生成角色/delegation skill；`sense-environment`、`verify-change` 需 `processSkills: true`（CLI `--process-skills`）才生成，均使用 DSH 原生 `bash`/`read`/`grep` 等工具，不注册自造工具；
- `evals/cases.jsonl` + `evals/run.mjs`（按 case 调 `dsh headless`，记录 transcript，不自动判分）；
- 可选 `mcp`：生成 `dsh-mcp-client` 行，支持 stdio / streamable-http，`${ENV_VAR}` 转为 `!!js process.env.*`；
- 可选 `writeAgents`：把带 marker 的 section 幂等合并进 `AGENTS.md`，保留用户内容。

模板：`repo-coder`、`web-researcher`；`ops-runbook`、`browser-operator`、`data-analyst`、`support-router` 标记为 `experimental`（依赖外部 MCP/知识库，尚未做任务验证）。

宿主路由：

- `GET /api/agent-embodiment/status/scaffold/templates`
- `POST .../scaffold/preview`（只返回文件计划，不写盘）
- `POST .../scaffold/generate`（要求绝对 `targetDir`；拒绝系统目录、home 及其祖先、`$DSH_HOME` 与常见凭据目录；默认拒绝覆盖，`overwrite:true` 才覆盖；路径逃逸校验）

命令行：`node scripts/agent-scaffold.mjs --template <id> --out <absolute-workspace>`。

模板只挂 preset 内需要的 row；`dsh-subagent` service 与 `spawn` provider 已由基础组合全局提供，preset 只挂 `dsh-tool-subagent`，避免重复注册导致 preset 激活失败。生成的 preset 复用 `agent-embodiment/control` 做上下文压缩，因此同一 profile 需要安装本插件。

**子 agent 跨版本兼容**：DSH 0.2.1-rc.2 已移除 `dsh-tool-subagent` 的 `persona` 与 `toolFilter`（要求改用单独的 Agent Preset + `agentPreset` 选择）。生成器只保留 `provider`/`toolName`/`backgroundMode`/`maxDepth` 等跨版本字段，角色说明改为生成的 `delegate-<role>` skill；0.2.0-rc.2 与 0.2.1-rc.2 均已实测 preset 激活。
