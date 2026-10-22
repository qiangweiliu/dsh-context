# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

DeepSeek Harness（DSH）的上下文管理插件仓库。可发布的主体是 `ctx-mon-and-con/`（npm 包名 `ctx-mon-and-con`，当前 `package.json` 版本 `0.19.1`），其余目录是配套资产：

- `eval/`：提示词 / 推理档位对照评测（GSM8K、MATH Level 5），以及结果与报告。
- `research/`、`explore/`：对 DSH 插件机制、compaction、UI 的逆向调研与设计笔记。
- `scripts/`：WSL 安装、profile 清理、Edge/CDP UI 验证等一次性脚本。
- 根目录 `dsh-upgrade-checklist.md`、`dsh-context-v0.66.1-review.md`：DSH/插件升级与第三方插件审查记录，与当前插件源码无关。

仓库文档和代码注释以中文为主，新增文档/注释保持中文。

## 常用命令

### 单元测试（CI 运行，不依赖 DSH 运行时）

```bash
cd ctx-mon-and-con
npm test                    # test/static.mjs + test/metrics.mjs + test/state.mjs
node test/static.mjs        # 只跑静态/模块形状检查
node test/metrics.mjs       # 只跑会话日志折叠统计
node test/state.mjs         # 会话开关/提示词文本持久化往返
```

CI 位于 `.github/workflows/test.yml`，只跑 `npm test`。

### 集成测试（需要本机 DSH 的 app.asar）

```bash
cd ctx-mon-and-con
node test/prepare-deps.mjs          # 从 app.asar 解出 cordis/cosmokit 到 test/deps/
npm run test:integration            # control + smoke + prompt-state
node test/control.mjs               # 单独跑某一个（先 prepare-deps）
node test/smoke.mjs
node test/prompt-state.mjs
```

`prepare-deps.mjs` 默认找 Windows 桌面版 `app.asar`，可用 `DSH_ASAR=/path/to/app.asar` 覆盖。`test/deps/` 是生成物，已 gitignore。

语法检查（仓库没有 lint 配置）：

```bash
cd ctx-mon-and-con
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
```

`eval/run.mjs` 的对照臂（`--arms`）定义在文件顶部 `PATCHES`，题目与结果都是 JSONL（每行含 `id`、`cond`）。`eval/REPORT.md` 记录实验设计与结论；改提示词模板后至少用 `make-template-patch.mjs` 保证测的是实际下发文本。

### 本地安装与 UI 验证

```bash
bash scripts/wsl-install.sh web
bash scripts/wsl-uninstall.sh web
bash scripts/wsl-start-web.sh 3080        # 启动 WSL web profile，输出带 token 的 URL
node scripts/ui-probe.mjs "<url>" --section=... 
node scripts/ui-screenshot.mjs "<url>" <out.png>
node scripts/wait-for-ctx-plugin.mjs "<url>" 15   # 等待运行中的实例热加载插件
node scripts/clean-ctx-profile-patch.mjs ~/.dsh/profiles/<profile>
```

UI 脚本通过 Windows Edge 的 CDP 连接（`scripts/lib/cdp.mjs`，默认 Edge 路径可用 `EDGE_PATH` 覆盖），因此要在能访问 Windows Edge 的 WSL 环境里跑。`scripts/wsl-*.sh` 会操作真实 profile，跑之前确认目标环境。

## 架构

### 两个 Cordis 插件半侧 + 共享状态

插件不是单一进程内插件，而是刻意拆成宿主平面和 agent preset 平面：

- `index.js`（宿主平面，`inject: ['commands', 'tokenMeter']`）：注册 `/ctx`、`/ctx <tokens>`、`/ctx reset`，注册 `/api/ctx-mon-and-con/status` 及其子路由，负责全局配置写入、会话开关与压缩日志落盘、`system-prompt/assemble` 装配钩子。
- `control.js`（preset 平面，`inject: ['tokenMeter']`）：在 `agent/pre-step` 测量并调用 `compaction.compactIfNeeded` / `compactRegion`，注册 `/ctx-compact`。`mode` 为 `idle`（默认，含范围压缩兜底）/ `pre-step` / `notify` / `off`。
- `state.js`：两个半侧共享的进程内状态。Cordis realm 隔离使二者互相 `import` 服务不可行，但同一包内 `./state.js` 的 ESM 模块缓存是同一份实例。
- `client.js`：浏览器半侧，经 `window.__ModuleLoader__.load` 注册 `settings.section`、`main`（`key='ctx'`）、`sidebar.panellist`、`conversation.composer.dock`。只用内联样式和 `--dsw-alias-*` token，不引 CSS/Tailwind。
- `dsh.bundle.patch.yml`：只 `insert` 一行宿主插件行，不覆盖任何宿主行。

控制半侧必须挂进 agent preset（设置 → Agent preset → compaction 组），原因：Web 形态下 `dsh-web-app` 把宿主平面的 compaction 行全部 disabled，真正的 `compaction` 服务在 `preset-standard` 的 isolate group 里，宿主上下文拿不到。插件启动时会自动往 `preset-standard` 补挂一行（受 `autoMountControl` 控制）。

**关键约束：`index.js` / `control.js` / `state.js` 不 import 任何 npm 包**（只用 Node 内置模块）。本地 `link:` 安装时插件目录没有宿主依赖，裸导入会解析失败。配置校验是手写的同步 Standard Schema（`Config['~standard'].validate`），因为 Cordis 不支持 async 校验。`test/static.mjs` 会断言无运行依赖、无安装生命周期脚本。

### 数据流

1. `tokenMeter.measure(agent.session)` 得到用量。
2. `budgetFor(sessionId, fallback)`：会话覆盖（`/ctx <tokens>`）> 宿主全局 `contextWindowTokens` > control 行自己的 `maxContextTokens` > 100000。
3. `control.js` 按 `triggerAt` / `targetAt` / `keepTokens` 压缩，并把结果写入 `state.js`。
4. 状态路由把测量、inventory、压缩日志、控制状态返回给 `client.js`；面板监听 DOM 变化，2 秒节流刷新，空闲不轮询。

`promptOverrides` 只能覆盖已有 section；`extraPrompts` 才新增 section。新增提示词 `extraPromptPlacements[name] === 'user'` 时不插 system section，而是在 `agent/pre-step` 的 `next()` 之后，把文本追加到本轮新用户消息末尾（`role === 'user'` 且 `source.kind === 'user'`），每个新用户提问都会追加一次，内容进入会话日志、UI 可见。

`PROMPT_TEMPLATES`（`index.js`）里的内置方法论模板只作为草稿来源，不默认注入。模板文本必须完全稳定（不能含时间戳、会话 id、随机量），否则每次请求都会 miss 提示词缓存；`test/prompt-state.mjs` 有对应断言。改动模板后应同步更新 `eval/REPORT.md` 的实测结论。

### 持久化与配置写入

- `~/.dsh/ctx-mon-and-con/session-toggles.json`：会话级工具/提示词开关、提示词文本覆盖、`autoMountControl`。
- `~/.dsh/ctx-mon-and-con/compaction-log.jsonl`：压缩记录，内存最多 200 条、磁盘超过 512KB 时截到最近 400 行。
- `~/.dsh/ctx-mon-and-con/backups/`：每次写配置前的自动备份。
- 全局配置、提示词覆盖、新增提示词都经 `ctx.configEditor` 写 profile 的 `cordis.patch.yml`；写入会触发 Loader 重挂插件。**patch 的 `config` 是整段替换，不做深合并**，改 preset 时务必保留要保留的字段。
- inventory（提示词 section / 工具清单）只存在进程内存，反映最近一次装配；新会话先发一条消息才有数据。

### 跨会话统计

`metrics.js` 把会话事件日志折叠成 turn/step/usage/费用统计（`index.js` 的状态接口消费）。费用只对内置 `MODEL_PRICING` 覆盖的 DeepSeek 模型估算，未知模型显示 `—`；跨会话分析默认只扫描最近 40 个会话（见 `docs/LIMITATIONS.md`）。每个 fold 带 `daily` 按日桶，区间 KPI 与图表都从同一批桶取数；压缩摘要的 usage/cost 也计入总账。

## 开发约定与易错点

- 版本号以 `ctx-mon-and-con/package.json` 为准。根 `README.md`、`docs/IMPLEMENTATION.md`、`docs/EVIDENCE.md` 和 `client.js` 的 `accountMeta().version` 是手工维护的副本；`test/static.mjs` 现在会断言 `client.js` 版本与 `package.json` 一致。改版本时仍要同步文档。
- 首次安装/启停由 DSH HMR 热生效，不需要重启 DSH；Web 0.2.0-rc.2 与 Desktop 0.2.1-rc.2 均已实测（`EVIDENCE.md` E16/E17）。页面没更新时 Web 刷新一次即可。替换已安装包（升级版本）仍需要重启 DSH 进程；修改 `client.js` 后 HMR 会重载，失败时刷新页面。面板在宿主/客户端版本不一致时会显示“刷新页面”提示。安装后不显示时先确认 `--profile` 与运行实例一致（Desktop=`desktop`，WSL web=`web`）。
- 第三方插件不能默认 `import '@deepseek-ai/*'`；集成测试才从 app.asar 解出真实 Cordis。
- 测试会临时改 `HOME`/`USERPROFILE` 到临时目录（`smoke.mjs`、`prompt-state.mjs`），避免污染真实 profile；新增落盘逻辑时保持这一习惯。
- 不要手改 `cordis.yml`（恒为空）；用户 tweak 写 `cordis.patch.yml`，插件自身走 `ctx.configEditor`。
- 追加到用户消息末尾的提示词不是隐藏指令，会在会话历史里可见；不要把它当作秘密注入机制。

## 文档地图

- `ctx-mon-and-con/README.md`：用户功能与入口。
- `ctx-mon-and-con/docs/IMPLEMENTATION.md`：实现细节、路由清单、测试结果（最接近架构总览）。
- `ctx-mon-and-con/docs/LIMITATIONS.md`：行为边界与已知限制。
- `ctx-mon-and-con/docs/EVIDENCE.md`：逐版本 UI/运行证据。
- `ctx-mon-and-con/PERMISSIONS.md`：访问面披露。
- `research/arch.md`：DSH 插件/bundle/client 机制调研（写新插件集成时先看）。
- `eval/REPORT.md`：评测设计、结果与结论。
