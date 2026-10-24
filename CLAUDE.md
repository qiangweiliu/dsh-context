# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

DeepSeek Harness（DSH）的 agent 具身与上下文管理插件仓库。市场显示名 `Agent Embodiment` / `智能体具身`；包名/目录 `agent-embodiment`；短品牌 `embody`。旧名 `ctx-mon-and-con` 仅用于历史记录和兼容别名。可发布的主体是 `agent-embodiment/`（npm 包名 `agent-embodiment`，当前 `package.json` 版本 `0.23.0`），其余目录是配套资产：

- `eval/`：提示词 / 推理档位对照评测（GSM8K、MATH Level 5），以及 Tier B 50 题深度套件与结果报告。
- `research/`、`explore/`：对 DSH 插件机制、compaction、UI 的逆向调研与设计笔记。
- `scripts/`：WSL 安装/启动、profile 清理、Edge/CDP UI 验证、脚手架 CLI 等运维脚本。
- `docs/`（根）：插件设计方案、市场提交、安全审计；`submission/`：市场收录 PR 用的条目 YAML。
- `.probe/`：本地调试抓取物（asar 解包、CDP 日志、截图），已 gitignore，不属于源码。
- 根目录 `dsh-upgrade-checklist.md`、`dsh-context-v0.66.1-review.md`：DSH/插件升级与第三方插件审查记录，与当前插件源码无关。

仓库文档和代码注释以中文为主，新增文档/注释保持中文。

## 常用命令

### 单元测试（CI 运行，不依赖 DSH 运行时）

```bash
cd agent-embodiment
npm test                    # static + metrics + state + scaffold
node test/static.mjs        # manifest/exports/Config/client 形状与文本断言
node test/metrics.mjs       # 会话日志折叠统计
node test/state.mjs         # 会话开关/提示词文本持久化往返
node test/scaffold.mjs      # 脚手架生成计划、YAML 与 AGENTS 合并
```

当前基线（0.23.0）：static 83/83、metrics 24/24、state 16/16、scaffold 146/146。

CI 在 `.github/workflows/test.yml`：Node 20/22/24 三档，先 `node --check index.js control.js client.js`，再 `npm test`，最后 `npm pack --dry-run`（提前暴露 `files`/`exports` 缺文件）。

### 集成测试（需要本机 DSH 的 app.asar）

```bash
cd agent-embodiment
node test/prepare-deps.mjs          # 从 app.asar 解出 cordis/cosmokit 到 test/deps/
npm run test:integration            # control + smoke + prompt-state
node test/control.mjs               # 单独跑某一个（先 prepare-deps）
node test/smoke.mjs
node test/prompt-state.mjs
```

`prepare-deps.mjs` 默认找 Windows 桌面版 `app.asar`，可用 `DSH_ASAR=/path/to/app.asar` 覆盖。`test/deps/` 是生成物，已 gitignore。当前基线：control 54/54、smoke 71/71、prompt-state 11/11。

### 语法检查（仓库没有 lint 配置）

```bash
cd agent-embodiment
node --check index.js
node --check control.js
node --check client.js
```

### 评测

评测通过 `dsh --profile headless`（headless/PATCH 覆盖）运行，不修改 profile。默认二进制是 `~/.local/bin/dsh`，可用 `DSH_BIN` 覆盖。

```bash
node eval/sample.mjs                                  # GSM8K 等距抽 50 题 -> eval/questions.jsonl
node eval/sample-math.mjs                             # MATH L5 抽 50 题 -> eval/questions-math.jsonl
node eval/run.mjs --workers 4 --arms a,b,c            # 提示词对照；断点续跑
node eval/report.mjs eval/results/main.jsonl          # 正确率 / 逐题对照 / McNemar
python3 eval/grade-math.py eval/results/math5.jsonl   # MATH 用 sympy 判分
node eval/effort-test.mjs --tiers low,high --limit 10
node eval/summarize-effort.mjs <file.jsonl> [--math]
node eval/agent-ab/run.mjs --reps 3 --workers 3  # 插件安装 A/B/C（需隔离 DSH_HOME 与 profile）
node eval/deep/v2/make-suite.mjs --check         # Tier B 50 题自检（代码题参考实现）
node eval/deep/setup-conditions.mjs              # 准备 base/plugin/scaffold/compact 隔离 profile
node eval/deep/run.mjs --condition base --workers 2 --out eval/results/deep-b-base.jsonl
node eval/deep/compare.mjs --markdown            # 四组对照表
```

`eval/run.mjs` 的对照臂（`--arms`）定义在文件顶部 `PATCHES`，题目与结果都是 JSONL（每行含 `id`、`cond`）。`eval/REPORT.md` 记录实验设计与结论；改提示词模板后至少用 `make-template-patch.mjs` 保证测的是实际下发文本。`eval/deep/` 的四组条件由 `setup-conditions.mjs` 在 `/tmp` 下重建，可随时重跑。

### 本地安装与 UI 验证

```bash
bash scripts/wsl-install.sh web
bash scripts/wsl-uninstall.sh web
bash scripts/wsl-start-web.sh 3080        # 启动 WSL web profile，输出带 token 的 URL
node scripts/ui-probe.mjs "<url>" --section=...
node scripts/ui-screenshot.mjs "<url>" <out.png>
node scripts/wait-for-agent-embodiment.mjs "<url>" 15   # 等待运行中的实例热加载插件
node scripts/agent-scaffold.mjs --list             # Agent Embodiment 模板（6 个）
node scripts/agent-scaffold.mjs --template repo-coder --out /abs/workspace --slug my-agent \
  [--name "..."] [--overwrite] [--agents] [--process-skills] [--mcp <json> | --mcp-file <path>]
node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-uninstall.ps1 -Profile desktop -Clean
```

UI 脚本通过 Windows Edge 的 CDP 连接（`scripts/lib/cdp.mjs`，默认 Edge 路径可用 `EDGE_PATH` 覆盖），因此要在能访问 Windows Edge 的 WSL 环境里跑。`scripts/wsl-*.sh` 会操作真实 profile，跑之前确认目标环境。

## 架构

### 两个 Cordis 插件半侧 + 共享状态

插件不是单一进程内插件，而是刻意拆成宿主平面和 agent preset 平面：

- `index.js`（宿主平面，`inject: ['commands', 'tokenMeter']`）：注册 `/embody`、`/embody <tokens>`、`/embody reset`（并保留 `/ctx` 别名）；注册 `/api/agent-embodiment/status` 及其全部子路由；负责全局配置写入、会话开关与压缩日志落盘、全局工具禁用（`tools.restrict`）和自动挂载控制行。**它不做提示词装配**。
- `control.js`（preset 平面，`inject: ['tokenMeter']`）：在 `system-prompt/assemble` waterfall 里按会话重建 `result.sections`、应用 `promptOverrides` / `extraPrompts` / 禁用项并写 inventory；在 `agent/pre-step` 测量并调用 `compaction.compactIfNeeded` / `compactRegion`；`notify` 模式在 `agent/status === 'idle'` 时只记录；通过 `agent.ctx.tools.restrict({ deny })` 应用会话级工具禁用；注册 `/embody-compact`。`mode` 为 `idle`（默认，含范围压缩兜底）/ `pre-step` / `notify` / `off`。
- `state.js`：两个半侧共享的进程内状态。Cordis realm 隔离使二者互相 `import` 服务不可行，但同一包内 `./state.js` 的 ESM 模块缓存是同一份实例。
- `metrics.js`：把会话事件日志折叠成 turn/step/usage/费用统计，供宿主状态路由消费。
- `client.js`：浏览器半侧，经 `window.__ModuleLoader__.load` 注册 5 个 slot 条目（4 类 slot）：`settings.section`、`main`（`key='embody'`）、`sidebar.panellist`、`conversation.composer.dock` 两次（用量指示器 + 余额胶囊）。面板有 Overview / Trend / Events / Agent / Settings 五个 tab。只用内联样式和 `--dsw-alias-*` token，不引 CSS/Tailwind。
- `scaffold.js`：Agent Embodiment Scaffold 的纯函数生成器。把模板变成可安装的 DSH preset bundle（`.dsh/scaffolds/<slug>/`）、`.agents/skills/*/SKILL.md`（`sense-environment`、`verify-change`、角色/delegation skill，全部使用 DSH 原生工具）、SENSES/HANDS/LOOP、AGENTS 片段、MCP rows 和 eval cases/runner；不读写磁盘、不 import npm 包。合并 AGENTS.md 用 `mergeAgentsContent`（marker 幂等）。
- `locale/{en,zh}.json`：市场 `meta.title` / `meta.description`。
- `dsh.bundle.patch.yml`：只 `insert` 一行宿主插件行，不覆盖任何宿主行。

控制半侧必须挂进 agent preset（设置 → Agent preset → compaction 组），原因：Web 形态下 `dsh-web-app` 把宿主平面的 compaction 行全部 disabled，真正的 `compaction` 服务在 `preset-standard` 的 isolate group 里，宿主上下文拿不到。插件启动时会自动往 `preset-standard` 补挂一行（受 `autoMountControl` 控制），写入后回读校验，失败写 warning。

**关键约束：运行时代码（`index.js` / `control.js` / `state.js` / `metrics.js` / `scaffold.js`）不 import 任何 npm 包**（只用 Node 内置模块）。本地 `link:` 安装时插件目录没有宿主依赖，裸导入会解析失败。配置校验是手写的同步 Standard Schema（`Config['~standard'].validate`），因为 Cordis 不支持 async 校验。`test/static.mjs` 会断言无运行依赖、无安装生命周期脚本。

### 数据流

1. `tokenMeter.measure(agent.session)` 得到用量。
2. `budgetFor(sessionId, fallback)`：会话覆盖（`/embody <tokens>`，兼容 `/ctx`）> 宿主全局 `contextWindowTokens` > control 行自己的 `maxContextTokens` > 100000。
3. `control.js` 按 `triggerAt` / `targetAt` / `keepTokens` 压缩，并把结果写入 `state.js`。触发线 = 预算 × `triggerAt`，目标线 = 预算 × `targetAt`；`warnAt` / `errorAt` 只影响 UI 标记。
4. `compressionStrategy` 提供三档 preset：`conservative`（0.9 / 0.7 / keep 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）。只有显式 `triggerAt` / `targetAt` / `keepTokens` 缺省时才套用 preset；显式值优先。
5. 状态路由把测量、inventory、压缩日志、控制状态返回给 `client.js`；面板用 MutationObserver 监听会话区域 DOM 变化，2 秒节流刷新，空闲不轮询。

`promptOverrides` 只能覆盖已有 section；`extraPrompts` 才新增 section。新增提示词 `extraPromptPlacements[name] === 'user'` 时不插 system section，而是在 `agent/pre-step` 的 `next()` 之后，把文本追加到本轮新用户消息末尾（`role === 'user'` 且 `source.kind === 'user'`），每个新用户提问都会追加一次，内容进入会话日志、UI 可见；同名 section 不重复插入，空文本跳过。

`PROMPT_TEMPLATES`（`index.js`）里的内置方法论模板只作为草稿来源，不默认注入。模板文本必须完全稳定（不能含时间戳、会话 id、随机量），否则每次请求都会 miss 提示词缓存；`test/prompt-state.mjs` 有对应断言。改动模板后应同步更新 `eval/REPORT.md` 的实测结论。

跨会话分析默认扫描 `analyticsLimit` 个会话（默认 40，最大 200），请求里带 `?limit=` 可临时覆盖。费用只对 `MODEL_PRICING` 覆盖的 DeepSeek 模型估算，可用配置 `modelPricing`（`{ match, input, cacheRead, cacheWrite, output }`，CNY / 1M tokens）补充或覆盖；未知模型显示 `—`。

### HTTP 接口与安全

所有路由都挂在 `/api/agent-embodiment/status` 下，注册时统一套 `authed`：先调用 `ctx.connection.requestRejection`（Host/Origin + 浏览器/API 认证），拒绝返回 401/403；没有 `connection` 服务（如 headless）时放行。POST 只接受 `application/json`，其他 content-type 返回 415。

- 读取（GET）：`status`、`status/live`、`status/analytics`、`status/session-detail`、`status/inventory`、`status/scaffold/templates`。
- 写入（POST）：`status/config`（全局配置补丁，16KB 上限）、`status/config/preset`（控制行启停）、`status/inventory/{toggle,reset,prompt,prompt/reset,prompt/session,prompt/session/reset,extra-prompt,extra-prompt/reset}`、`status/scaffold/{preview,generate}`。
- 默认请求体上限 256KB（`readJson` 可传更小值）；配置补丁 16KB，脚手架 spec 64KB。
- `scaffold/generate` 要求绝对 `targetDir`，拒绝文件系统根、home 及其祖先、系统目录、`$DSH_HOME` 与常见凭据目录；逐文件校验路径不逃逸 `targetDir`；默认拒绝覆盖（409），`overwrite:true` 才覆盖。

### 持久化与配置写入

- `~/.dsh/agent-embodiment/session-toggles.json`：会话级工具/提示词开关、提示词文本覆盖、`autoMountControl`。
- `~/.dsh/agent-embodiment/compaction-log.jsonl`：压缩记录，内存最多 200 条；磁盘超过 512KB 时截到最近 400 行；面板展示最近 50 条。
- `~/.dsh/agent-embodiment/backups/`：每次写配置前的自动备份，保留最近 30 份。
- 全局配置、提示词覆盖、新增提示词都经 `ctx.configEditor` 写 profile 的 `cordis.patch.yml`；写入会触发 Loader 重挂插件。**patch 的 `config` 是整段替换，不做深合并**，改 preset 时务必保留要保留的字段。
- inventory（提示词 section / 工具清单）只存在进程内存（每会话缓存最近 20 个），反映最近一次装配；新会话先发一条消息才有数据。

### Agent 脚手架

`scaffold.js` 是纯函数生成器，把 `EmbodimentSpec` 变成一份可安装的 Embodiment Pack：

- `.dsh/scaffolds/<slug>/package.json` + `dsh.bundle.patch.yml`：insert 一个 `@deepseek-ai/dsh-agent-preset` 行；
- `SENSES.md` / `HANDS.md` / `LOOP.md` / `AGENTS.snippet.md`；
- `.agents/skills/<slug>-<skill>/SKILL.md`（`dsh-skill-filesystem` 扫描）；默认只生成角色/delegation skill，`sense-environment` / `verify-change` 需 `processSkills: true`（CLI `--process-skills`、面板 checkbox）才生成；
- `evals/cases.jsonl` + `evals/run.mjs`：按 case 调 `dsh headless` 记录 transcript，不自动判分；
- 可选 MCP（stdio / streamable-http，`${ENV_VAR}` 转 `!!js process.env.*`）与带 marker 的 `AGENTS.md` 幂等合并。

模板 6 个：`repo-coder`、`web-researcher` 为可用模板；`ops-runbook`、`browser-operator`、`data-analyst`、`support-router` 标记 `experimental`（依赖外部 MCP/知识库，尚未做任务验证）。生成的 preset 复用 `agent-embodiment/control`，同一 profile 需安装本插件。子 agent 只保留跨版本字段（`provider`/`toolName`/`backgroundMode`/`maxDepth`），角色说明放 `delegate-<role>` skill；DSH 0.2.1-rc.2 已移除 `tool-subagent` 的 `persona`/`toolFilter`。

## 开发约定与易错点

- 版本号以 `agent-embodiment/package.json` 为准。`client.js` 的 `CLIENT_VERSION` 是硬编码副本，`test/static.mjs` 会断言它与 `package.json` 一致；根 `README.md`、`docs/IMPLEMENTATION.md`、`docs/EVIDENCE.md`、`docs/RELEASE-PLAN.md`、`CHANGELOG.md` 与 `locale/*.json` 的描述是手工维护的副本，改版本时同步。
- 首次安装/启停由 DSH HMR 热生效，不需要重启 DSH；Web 0.2.0-rc.2 与 Desktop 0.2.1-rc.2 均已实测（`EVIDENCE.md` E16/E17）。页面没更新时 Web 刷新一次即可。替换已安装包（升级版本）仍需要重启 DSH 进程；修改 `client.js` 后 HMR 会重载，失败时刷新页面。面板在宿主/客户端版本不一致时会显示“刷新页面”提示。安装后不显示时先确认 `--profile` 与运行实例一致（Desktop=`desktop`，WSL web=`web`）。
- 第三方插件不能默认 `import '@deepseek-ai/*'`；集成测试才从 app.asar 解出真实 Cordis。
- Agent 脚手架生成 preset 时，`dsh-subagent` service 与 `spawn` provider 已由基础组合全局提供，preset 只挂 `dsh-tool-subagent`；重复挂载会让 preset 激活失败（E18 实测）。
- 测试会临时改 `HOME`/`USERPROFILE` 到临时目录（`smoke.mjs`、`prompt-state.mjs`），避免污染真实 profile；新增落盘逻辑时保持这一习惯。
- 不要手改 `cordis.yml`（恒为空）；用户 tweak 写 `cordis.patch.yml`，插件自身走 `ctx.configEditor`。
- 追加到用户消息末尾的提示词不是隐藏指令，会在会话历史里可见；不要把它当作秘密注入机制。
- 控制行未挂载时，工具/提示词开关不会生效：0.23.0 起面板会显示 `controlRequired` 提示并拒绝执行，但会话级开关仍会落盘。排查“开关没反应”先看 `control.active`。
- `compressionStrategy` 与显式 `triggerAt`/`targetAt`/`keepTokens` 同时出现时以显式值为准；在 `cordis.patch.yml` 里改 preset 要保留不想丢的字段（整段替换）。
- 文档存在少量滞后：`docs/IMPLEMENTATION.md` 的兼容范围未列 `0.2.1-rc.3`，`docs/security-audit.md` 停留在 0.21.0；以 `package.json` 的 `engines.dsh` / `dsh.compatibility` 为准。
- `.probe/` 是本地调试残留，不要提交；`test/deps/` 由 `prepare-deps.mjs` 生成。

## 文档地图

- `agent-embodiment/README.md`：用户功能与入口。
- `agent-embodiment/docs/IMPLEMENTATION.md`：实现细节、路由清单、测试结果（最接近架构总览）。
- `agent-embodiment/docs/LIMITATIONS.md`：行为边界与已知限制。
- `agent-embodiment/docs/EVIDENCE.md`：逐版本 UI/运行证据（E16–E26 覆盖 0.19–0.23）。
- `agent-embodiment/docs/RELEASE-PLAN.md`：0.22.0 → 1.0.0 的版本路线图、发布门禁、兼容矩阵与回滚步骤。
- `agent-embodiment/docs/UI-PROPOSAL.md`：面板信息架构与视觉提案。
- `agent-embodiment/CHANGELOG.md`：版本变更记录（Keep a Changelog）。
- `agent-embodiment/PERMISSIONS.md`：访问面披露。
- `research/arch.md`：DSH 插件/bundle/client 机制调研（写新插件集成时先看）；`research/context-core.md`：上下文与压缩子系统。
- `eval/REPORT.md`：评测设计、结果与结论；`eval/PLUGIN-AB.md`：插件安装 / 不安装的 agent 能力对照（63 次运行）。
- `eval/deep/`：Tier B 50 题深度套件（20 多轮记忆 / 15 长上下文 / 9 代码 / 6 仓库），用于 base / plugin / scaffold / compact 四组对照；`README.md` 是使用说明，`RESULTS.md` 与 `COMPARE.md` 是实测结果，旧版题目在 `archive/`。
- `docs/context-length-plugin-plan.md`：插件设计起点与 seam 分析；`docs/market-submission.md`：市场上架排查记录；`docs/security-audit.md`：写操作/回滚路径审计。
- `submission/qiangweiliu__dsh-context--agent-embodiment.yml`：市场收录 PR 的条目文件。
