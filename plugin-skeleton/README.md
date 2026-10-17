# ctx-mon-and-con

DSH（DeepSeek Harness）的**上下文长度管理**插件，分两个平面：

- **宿主半侧（`index.js`，装完即有）**：`/ctx` 读出当前会话的 token 用量与预算，只读的设置面板 + `GET /api/ctx-mon-and-con/status`；**不修改会话**。
- **控制半侧（`control.js`，需要挂进 agent preset）**：到达预算就自动压缩，或手动 `/ctx-compact`；走官方 `ctx.compaction` seam，不自己造压缩。

## 设置面板在哪

装好后**重启 dsh 进程**（不是刷新页面），你现在有三个入口看到同一块面板：

1. **左侧导航的 `ctx`** —— 仪表盘图标，点开是整页「ctx —— 上下文长度控制」
2. **设置 → 上下文长度** —— 设置弹窗里的分区
3. `GET /api/ctx-mon-and-con/status` —— 面板的数据源

面板内容（概览占整行，下面控制 + 全局配置两列；没有折叠）：

```
ctx —— 上下文长度控制
┌ 预算 ─────────────────────────────────────────────────┐
│ 已同步  6%   7.4K / 128K                               │
│ ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░  4px（四色分段）            │
│ [提示词 1.4K·20%] [工具定义 5.2K·73%]                   │
│ [上文 12·0.2%] [本轮用户对话 483·6.8%]                  │
│ [警告阈值 75%] [超限阈值 90%] [控制 已启用]             │
└────────────────────────────────────────────────────────┘
┌ 控制 ───────────────────┐ ┌ 全局配置 ─────────────────┐
│ 已启用 + 说明 + [停用按钮] │ │ 默认预算 / 警告 / 超限      │
└─────────────────────────┘ │ 提示 + [保存]              │
                            └───────────────────────────┘
```

**全局配置是真写的**：保存后走宿主 `ctx.configEditor`，把值写进 profile 的
`cordis.patch.yml`（对应 `- id: ctx-mon-and-con` 那一行），然后 Loader 按新配置重挂插件。
实测：把 128000 改成 90000 → 面板显示「已保存」、`status` 接口的 `budget.tokens` 变成 90000、
`--dump-config` 里出现 `# == ctx-mon-and-con, patched by …/cordis.patch.yml`。

> **看不到侧栏 `ctx` 或设置分区？** 99% 是没重启进程：客户端模块清单在 dsh 启动时注入页面，
> 只刷新页面不会重新扫描新装的插件。`Ctrl+C` 停掉 `dsh --profile web` 再启动即可。
> 也可以用 `scripts/ui-probe.mjs` / `scripts/ui-probe-ctx.mjs` 无头验证（见仓库根 README）。

## 输入框下方的 ctx 指示器（与 DSH 内置 HUD 的关系）

注册了 `conversation.composer.dock`，在输入框下方、DSH 自带占用条旁边多一个**同款触发器**：

```
◔ ctx 6%
```

- 视觉规格直接对齐内置 `ContextMeter.trigger`：`font-size: var(--dsh-content-font-size-secondary,13px)`、
  `font-variant-numeric: tabular-nums`、`color: var(--dsw-alias-label-tertiary)`、`padding: 1px 8px`、
  `border-radius: var(--dsw-radius-sm)`，hover 背景 `--dsw-alias-interactive-bg-hover`；左侧是 14×14 的
  环形进度（轨道 `--dsw-alias-border-l3`）。
- 点开是一个**与内置 HUD 同规格的浮层**（264px、`--dsw-radius-lg`、`--dsw-specific-menu`、
  `--dsw-elevation-prominent`、12px/20px）：`预算 | 6% | ~7.4K / 128K` + 4px 进度条 +
  实测用量 / 剩余 / 控制状态三行。
- 百分比按**插件预算**算（7,379 / 128,000 ≈ 6%）。
- DSH 自带那块 `上下文已用 3% ~9.3K / 262K` **保持原样**：它显示模型真实窗口（262K）与官方
  tokenMeter 投影，插件没有覆盖它。两者口径不同是刻意的。
- 指示器只在**已选中会话的 composer** 上渲染；空白首页（Hero）没有会话，不显示。
- dock **不轮询**：打开会话时取一次，之后每次点开浮层再取一次。

## 面板视觉

整页与设置分区共用一套卡片式版面（参考 `dsh-context` 插件的信息密度，但全部用内联样式 +
`--dsw-alias-*` token，不引入 CSS 文件/Tailwind）：

- 卡片：`--dsw-alias-bg-layer-1` 背景 + `0.5px --dsw-alias-border-l1` 边框 + 12px 圆角
- 概览卡（占整行）：大号百分比 + 4px 预算条 + 阈值/控制 chip（`--dsw-alias-interactive-bg-hover` 胶囊）
- 控制卡 + 全局配置卡并排两列，**全部常展开、没有折叠**
- 不使用柱状趋势图；最近一次测量直接体现在概览卡的百分比/时间与 `预算` 卡里

## 预算构成四色（skill / 提示词 / 上文 / 本轮用户）

概览卡的预算条和 dock 浮层里的进度条都按**四桶构成**分段着色，下面跟一行图例：

| 色块 | 名称 | 含义 | 颜色 |
|---|---|---|---|
| 灰蓝 | 提示词 | 系统提示词（skill 内容并入这里） | `--dsw-static-neutral-bluish-400` |
| 紫 | 工具定义 | 工具/函数定义（skill 暴露的工具也并入这里） | `#a78bfa` |
| 蓝 | 上文 | 历史轮次的可见消息 | `--dsw-static-blue-450` |
| 绿 | 本轮用户对话 | 最近一轮的用户输入（含尚未回复的待处理输入） | `--dsw-static-green-400` |

数据口径：

- 数据来自宿主 `GET /api/ctx-mon-and-con/status/live`（不带 sessionId 时宿主取最近一个会话），
  所以不用执行 `/ctx`、也不用等测量记录，页面与 dock 的数字同源。
- 概览卡**只在打开页面时同步一次**（切回页面/窗口重新可见、或点「刷新」时再同步），**没有 3 秒轮询**；
  停留期间数字不会自己变。
- 进度条首次渲染时从 0 平滑增长到当前值（`width` 0.7s 过渡），数值变化时同样有过渡。

- 前三桶来自官方 `contextBreakdown` 投影（`systemTokens / toolsTokens / messageTokens`），
  与 DSH 内置 HUD 同源；**官方没有独立的 skill 桶**，skill 的文本实际落在提示词/工具定义里。
- 「本轮用户对话」= 倒数第二条 assistant 消息之后的全部 `user/message` 节点；其余可见消息算「上文」。
  该规则不依赖 turn 字段，回放、compaction、steering 后仍成立。
- 四桶都是**固定启发式**估算，合计不保证等于 provider 报的 `used`（内置 HUD 也一样，
  差距来自 provider anchor 的启发式误差）。

实测（WSL，一轮 `hi` + `/ctx`）：

```
提示词 1.4K · 20.3%    工具定义 5.2K · 72.7%    上文 12 · 0.2%    本轮用户对话 483 · 6.8%
```

## 工具与提示词清单（可开关）

ctx 整页底部新增「工具与提示词」卡，展示**当前会话**这次请求实际用到的：

- **工具**：26 个（名称 + `~token` 估算），每个工具有 **两个开关**：
  - `会话`：只对当前会话生效（内存，重启/切换会话恢复）
  - `全局`：写入 profile 的 `disabledTools`，所有会话生效（改配置会重挂插件）
- **提示词 section**：22 个（`harness:identity`、`tool:bash`、`ui:deliverable-file-references` 等，
  名称 + `~token` 估算），每个 section 一个 `会话` 开关（按你的选择，提示词不做全局开关）。
- 关闭前会二次确认；底部「恢复全部（会话）」一键清空本会话开关；卡片上标注风险提示。

折叠与详情：

- 两个大分区（工具 / 提示词 section）默认**收起**（标题旁保留数量），点开分区后才显示条目；每个工具 / section 也默认收起。
- 展开工具：完整 description + 参数 JSON Schema（格式化、等宽字体、带复制按钮）。
- 展开提示词 section：完整原文（等宽字体、带复制按钮，不限高）。
- 展开内容直接来自 inventory 接口（宿主把装配时的 	ool.parameters 与 section.text 全量带回）。

实现（全部走官方 seam，不 import 任何包）：

- 会话级工具：`agent.ctx.tools.restrict({ deny })`，在 `agent/pre-step` 里按当前开关重装/撤销，
  下一次请求生效（实测 `applied.deny` 里能看到被摘掉的工具名）。
- 会话级提示词：在 `agent.ctx` 上挂 `system-prompt/assemble` waterfall，`await next()` 后
  `sections.filter(...)` 剔除被关的 section（实测装配结果里该 section 消失）。
- 全局工具：插件 `Config.disabledTools` + 根作用域 `ctx.tools.restrict`，经 `ctx.configEditor`
  写回 profile（实测 `cordis.patch.yml` 出现 `disabledTools: [...]`）。
- 清单来源：每次装配时把 `result.sections` / `result.tools` 的名称与 token 估算记进 `state.js`，
  宿主 `GET /api/ctx-mon-and-con/status/inventory` 提供给面板。

> 会话级开关依赖 **`ctx-mon-and-con/control` 已挂进 agent preset**（见上一节）；没挂时开关能存，
> 但不会应用到请求。

## 更新时配置保留（已实测）

| 状态 | 位置 | remove + 重新 add | 官方 `update` |
|---|---|---|---|
| 全局预算/阈值/全局提示词/全局工具/autoMount 标志 | profile `cordis.patch.yml` | ✅ 文件逐字节不变 | ✅ 文件逐字节不变 |
| preset 控制行 | profile `cordis.patch.yml` | ✅ 保留 | ✅ 保留 |
| 会话开关/会话文本/自动挂载标志 | `~/.dsh/ctx-mon-and-con/session-toggles.json` | ✅ sha256 不变 | ✅ sha256 不变 |

验证方法：临时 profile 安装 → 写入可识别配置（111000/0.7/0.85、禁用 bash、promptOverrides）→ remove+add → update，前后对比文件 hash 与内容。

## 标准安装与更新（DSH 官方方式）

包已带标准清单：`dsh.manifestVersion: 1`、`dsh.bundle.patch`、`dsh.client.platform: "web"`，可直接用官方 CLI 安装/更新。

```bash
# 安装（GitHub，和市场条目同一 spec）
dsh plugin --profile web add "github:qiangweiliu/dsh-context#path:/plugin-skeleton"

# 更新（官方命令）
dsh plugin --profile web update ctx-mon-and-con
# 若 GitHub 依赖需要重新解析到最新 commit，重复一次 add 即可（幂等覆盖）
dsh plugin --profile web add "github:qiangweiliu/dsh-context#path:/plugin-skeleton"
```

npm 渠道已就绪但**尚未发布**（registry 上 `ctx-mon-and-con` 名字可用；发布需要 npm 登录）：

```bash
npm login
npm publish --access public
dsh plugin --profile web add ctx-mon-and-con
```

已实测（WSL 临时 profile，验证后删除）：

| 渠道 | 命令 | 结果 |
|---|---|---|
| GitHub spec | `dsh plugin add github:qiangweiliu/dsh-context#path:/plugin-skeleton` | ✅ 装上 0.12.2，profile 依赖切换为 github spec，`--dump-config` 可见行 |
| 官方 update | `dsh plugin update ctx-mon-and-con` | ✅ exit 0（无新 commit 时 "Already up to date"） |
| npm pack | `npm pack` | ✅ 产物含 index/control/client/state/locale/icon/bundle patch |
| npm tarball 安装 | `dsh plugin add ./ctx-mon-and-con-0.12.2.tgz` | ✅ 等价于发布后的 registry 安装 |

> 标准安装只挂**宿主行**；控制半侧（自动压缩）仍需按上文手动把 `ctx-mon-and-con/control` 挂进 agent preset。
## 重启后哪些状态保留

| 状态 | 存储位置 | 关闭 DSH 再启动 |
|---|---|---|
| 面板全局配置（预算/阈值） | profile `cordis.patch.yml` | ✅ 保留 |
| 全局提示词覆盖（promptOverrides） | profile config | ✅ 保留并在下一次请求生效 |
| 全局工具禁用（disabledTools） | profile config | ✅ 保留并在下一次请求生效 |
| 控制半侧是否启用 | agent preset 行 | ✅ 保留 |
| 会话级工具/提示词开关 | `~/.dsh/ctx-mon-and-con/session-toggles.json`（按 sessionId） | ✅ 保留（v0.12.0 起） |
| `/ctx <tokens>` 会话预算覆盖 | 进程内存 | ❌ 丢失 |
| 工具/提示词清单（inventory） | 进程内存 | ❌ 清空，需在新会话里先发一条消息重新装配 |
| 最近测量/压缩记录 | 进程内存 | ❌ 丢失 |

> 注意：全局工具禁用在 v0.11.2 之前**只写进了配置、重启后不会真正生效**（宿主平面拿不到 agent 的工具注册表）；
> 现在由控制半侧把全局禁用并入 `agent.ctx.tools.restrict`，重启后同样生效（实测工具数 26 → 25）。

## 一键启用自动压缩（让压缩也按插件预算）

控制半侧默认**自动挂载**（v0.13.0）：

- 插件启动时检查 `preset-standard` 的 compaction 组；没有 `ctx-mon-and-con/control` 行就自动写入一行（通过 `ctx.configEditor`，只写 profile 覆盖层）。
- 在面板点「停用自动压缩」后，会移除 preset 行并把 `autoMountControl: false` 记到
  `~/.dsh/ctx-mon-and-con/session-toggles.json`；此后启动不会自动加回。
- 点「启用自动压缩」会恢复自动挂载并把标志置回 true。
- 面板按钮仍可手动启用/停用：

- **启用自动压缩（写入 agent preset）** —— 把 `ctx-mon-and-con/control` 行写进 `preset-standard`
  的 compaction 组（走宿主 `ctx.configEditor`，写进 profile 的 patch 层），重挂后
  `control.active=true`，轮末超预算即压缩。
- **停用自动压缩（移除 preset 行）** —— 把该行移除。

写入的是 **preset-standard 的整段 config 快照**，这是 DSH 的既定行为；DSH 升级 preset 后
需要按新默认重新点一次或手工同步。默认 `mode: idle`：轮末检查、超预算就压。

## 三条功能

| # | 功能 | 怎么用 |
| --- | --- | --- |
| 1 | 监控当前会话上下文长度 | 会话里发 `/ctx`；设置 → 上下文面板；`GET /api/ctx-mon-and-con/status` |
| 2 | 设置上下文长度（预算） | `/ctx <tokens>` 设**当前会话**的临时预算、`/ctx reset` 恢复默认；全局默认在插件 `Config.contextWindowTokens`（profile patch 或 preset 里改） |
| 3 | 到达预算时主动压缩 | 控制半侧 `mode: idle`（默认）在轮末自动压缩；需要 step 内触发用 `pre-step`；也可 `/ctx-compact` 手动压 |

**预算三级取值**（控制半侧每次触发时实时计算，改完立即生效）：会话级覆盖（`/ctx <tokens>`）→ 宿主默认（`Config.contextWindowTokens`）→ 控制行自己的 `maxContextTokens`。

## 控制半侧做什么

| `mode` | 行为 |
| --- | --- |
| `idle`（默认） | 每轮结束（`agent/status === 'idle'`）测量，超过预算就调用 `ctx.compaction.compactNow()` 强制压缩；压完仍超会按 `maxAttempts` 重试，直到降到预算以下或无可安全压缩的范围 |
| `pre-step` | 每个 step 边界调用 `ctx.compaction.compactIfNeeded(agent, 'pressure', signal)`，由本插件决定触发时机（适合把 `compaction-basic.auto` 关掉后接管） |
| `notify` | 只测量并写日志，不动作 |
| `off` | 完全不启用 |

压缩目标是「**降到预算以下即可**」：复用引擎自己的选区逻辑，不自己算范围、不写 `surfaceOp`、不碰影子价。另外注册 `/ctx-compact`：立刻对该会话做一次 idle 压缩（同样要求 agent 空闲）。

```yaml
# 设置 → Agent preset（或在 profile patch 的 preset 配置里）加一行：
- id: ctx-mon-and-con-control
  name: 'ctx-mon-and-con/control'
  config:
    mode: idle          # off | notify | idle | pre-step
    cooldownMs: 60000   # 两次自动压缩最小间隔
    maxAttempts: 2      # 压完仍超预算时最多连续压几次
    # maxContextTokens: 100000  # 0（默认）= 跟随宿主默认与会话覆盖
```

**为什么必须挂在 preset 里**：Web 形态下 `dsh-web-app` 把宿主平面的 `compaction-basic` / `command-compact` / `tool-result-pruner` 全部置为 `disabled`，真正运行的 `compaction` 服务在 `preset-standard` 的 `cordis:group`（`isolate: { compaction: true }`）内。宿主上下文 `ctx.get('compaction')` 拿不到它 —— 面板里的「控制」一行会直接显示当前是否已生效（状态经 `state.js` 在两个半侧之间共享）。

## 卸载与残留（实测）

```powershell
# 官方通道，等价于插件管理器的 remove_bundle
& <dsh> plugin --profile desktop remove ctx-mon-and-con
```

实测结论（隔离 profile 20/20 项通过，真实 desktop profile 同样验过）：

| 场景 | package.json / bundles | pnpm-lock | cordis.patch.yml | 命令/面板 |
| --- | --- | --- | --- | --- |
| **冷卸载**（先退出 Desktop） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |
| **热卸载**（Desktop 运行中，`link:` 本地目录安装） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |
| **热卸载**（`github:` / npm 安装） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |

热卸载唯一的差异：`link:` 安装会残留一个 `node_modules/ctx-mon-and-con` **junction**（pnpm 在应用占用该目录时删不掉，实测 cold 卸载不会）。它只指向你的插件源码目录、不是真实副本，用下面的脚本 `-Clean` 可以安全移除（`rmdir` 只删 junction，不碰源码）：

```powershell
# 需要 PowerShell（Windows 自带 powershell.exe 即可）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-uninstall.ps1 -Profile desktop -Clean
```

脚本会：快照 → 安装 → 校验（依赖/bundles/link/组合树）→ 卸载 → 与快照对比 → 分类报告残留。
不带 `-Clean` 时只报告不清理；带上则顺带清掉三类**通用**残留（任何插件都一样）：
空 `pnpm-lock.yaml`、空的 `node_modules/.pnpm` 与 `.pnpm-workspace-state-v1.json`、本次操作产生的 `.plugin-manager/logs/operation-*`。

第三方观测到的两个注意点：

- **重启 Desktop 后** `/ctx`、`/ctx-compact` 与设置面板才会真正消失：运行中的进程会保留已加载的模块，卸载只改 profile 配置，不会热卸载已激活的插件。
- `desktop` profile 由 Electron 独占，CLI 拒绝 `--dump-config`；组合树是否含该行要在非 desktop profile 或应用重启后验证（脚本会自动跳过这一项并说明）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Cordis 插件（宿主侧）：`name` / `inject` / `Config`（手写 Standard Schema）/ `apply(ctx, config)`，注册 `/ctx` 命令、状态路由与 `POST /api/ctx-mon-and-con/config`（经 `ctx.configEditor` 写回 profile patch） |
| `control.js` | Cordis 插件（preset 侧）：预算控制 + `/ctx-compact`，零 import，只用 `ctx.compaction` 服务 |
| `state.js` | 两个半侧共享的进程内状态（默认预算 / 会话覆盖 / 控制状态）；只是同包相对 import |
| `client.js` | 浏览器半侧：`apply(ctx)` 里注册 `sidebar.panellist`（左侧 `ctx` 图标）、`main`（整页 `key: ctx`）与 `settings.section`（设置分区），三处共用同一面板组件 |
| `dsh.bundle.patch.yml` | bundle 层：往 profile 的 boot graph `insert` 一行 `id: ctx-mon-and-con` |
| `locale/{en,zh}.json` | 插件市场/插件管理页显示的 `meta.title` / `meta.description` |
| `icon.svg` | 插件图标（`exports["./icon"]` 暴露） |
| `test/static.mjs` | 纯离线静态检查（40 项，不需要 DSH） |
| `test/smoke.mjs` | 用真实 Cordis 的集成冒烟测试（43 项，需先 `node test/prepare-deps.mjs`） |
| `test/control.mjs` | 控制半侧的离线测试（33 项：预算来源、idle/pre-step/notify、重试、cooldown、命令、状态回写、卸载） |
| `test/prepare-deps.mjs` | 从 app.asar 离线解出 cordis/cosmokit 到 `test/deps/`（交付不带第三方副本） |
| `test/dump-config-smoke.txt` | 隔离 profile 里 `--dump-config` 的实际输出证据 |

设计上 **`index.js` 不 import 任何 npm 包**：本地目录安装时插件以 `link:` 落在 profile 的 `node_modules` 里，Node 会按真实路径解析裸导入，而插件目录通常没有宿主依赖（见下文"限制"）。

## 安装

前提：先打开过一次 DeepSeek Harness Desktop（初始化 `~/.dsh/profiles/desktop`），装完插件后重启 Desktop。

### 方式 A：Desktop 插件管理（推荐）

在会话里让 agent 调用 `plugin_manager` 工具：

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\ctx-mon-and-con" }
```

`install_bundle` 的 `target` 可以是本地目录、包名、git 或 tarball；本地目录会被记录成 `link:` 依赖。该工具需要 `danger-full-access` 权限。装好后 profile 的 `dsh.profile.bundles` 末尾会追加 `ctx-mon-and-con`（"新装组合包默认启用"），因此**同名 id 的配置优先级可能变化**。

### 方式 B：命令行

本机 `dsh` 不在 PATH，用完整路径：

```powershell
$dsh = "C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "C:\path\to\ctx-mon-and-con"
```

底层是 `pnpm add`（本地目录 → `link:`）+ 校验本包的 `dsh.bundle.patch` + 把包名追加进 `package.json` 的 `dsh.profile.bundles`。pnpm 退出码非 0 或超时会回滚 `package.json` 与 `pnpm-lock.yaml`。

> ⚠️ 不要在做安装实验时把 `DSH_HOME` 指到插件目录内部（例如 `<插件>/test/dsh-home`）：profile 的 `node_modules` 会 link 回插件目录，而 profile 又在插件目录里，形成自我引用的无限嵌套。实验用 profile 放到插件目录之外。

### WSL（Linux 侧的 dsh）

```bash
# 在 WSL 里执行；<repo> 换成本仓库路径
bash /mnt/c/<repo>/scripts/wsl-install.sh web      # 安装并核对
bash /mnt/c/<repo>/scripts/wsl-uninstall.sh web    # 卸载并核对残留
```

脚本把插件复制到 `~/dsh-plugins/ctx-mon-and-con` 再执行 `dsh plugin add`（不在 `/mnt/c` 上做 link，避免 drvfs 链接与性能问题）。
实测结论：安装后 `--dump-config` 出现该行、运行时 `/api/ctx-mon-and-con/status` 返回 200、客户端 bundle 正常下发；
卸载后 package.json / bundles / lock / 组合树均无该插件，pnpm 在 Linux 上会残留一个指向插件目录的 symlink，脚本会自动移除。

### 方式 C：手工（不推荐）
等价于管理器做的事：在 profile 目录 `pnpm add link:<插件目录>`，再手动把 `ctx-mon-and-con` 追加到 profile `package.json` 的 `dsh.profile.bundles`。漏掉任何一步插件都不会成为 profile 层（`dsh.bundle.patch` 解析失败时只作为普通依赖安装，管理器会打印 `declares no dsh.bundle` 警告并跳过）。

## 验证

1. **离线自检**（不启动 DSH）：

   ```powershell
   node test/static.mjs        # 40/40：导出形状、Config 校验、exports 解析、locale、client mock、control 形状
   node --check index.js; node --check control.js; node --check client.js
   node test/prepare-deps.mjs  # 可选：从 app.asar 解出 cordis，第一次需要
   node test/smoke.mjs         # 43/43：真实 Cordis 里加载、/ctx 与 reset、状态路由、卸载清理
   node test/control.mjs       # 33/33：预算来源、idle/pre-step/notify、重试、cooldown、命令、状态回写、卸载
   ```

2. **确认 bundle 层生效**：

   ```powershell
   & $dsh --profile desktop --dump-config | Select-String -Pattern 'ctx-mon-and-con' -Context 2
   # 期望看到：
   # # == ctx-mon-and-con
   # - id: ctx-mon-and-con
   #   name: ctx-mon-and-con
   ```

3. **重启 Desktop** 后在会话里发 `/ctx`（命令直接在 UI 命令面执行，不产生模型消息），再打开 设置 → 上下文 看面板；面板拉的接口是 `GET /api/ctx-mon-and-con/status`。

4. **调参**：全局默认在 profile 的 `cordis.patch.yml` 里按 id 覆盖（patch 是**整段替换**，不做深合并）；临时只想改当前会话就发 `/ctx <tokens>`，用完 `/ctx reset`：

   ```yaml
   - id: ctx-mon-and-con
     config:
       contextWindowTokens: 200000
       warnAt: 0.7
       errorAt: 0.85
   ```

## 卸载

```powershell
& $dsh plugin --profile desktop remove ctx-mon-and-con
# 或 plugin_manager: { "action": "remove_bundle", "target": "ctx-mon-and-con" }
```

会同步从 `dsh.profile.bundles` 里移除（管理器负责），重启 Desktop 后命令/面板/路由消失。

## 限制（重要）

- **Web 形态下宿主自带的 `auto` 自动压缩关不掉**：`@deepseek-ai/dsh-web-app` 层已把宿主平面的 `compaction-basic` 行设成 `disabled`，真正运行的实例藏在 `preset-standard` 条目的 `plugins` 里，bundle 层**无法按 id 命中**。要关 `auto` 必须在 profile 级 `cordis.patch.yml` 里对 `preset-standard` 做整段 config 覆盖（会连带把 preset roster 冻结成快照，直到 DSH 更新 preset 后重新复制；billion-context 的 `dsh.bundle.patch.yml` 注释记录了同一限制 DSH #2474）。控制半侧因此**必须挂在 preset 内**，见上节。
- **第三方插件默认不能 `import '@deepseek-ai/*'`**：宿主包在 `app.asar` 内、只由 DSH 自己的 loader（锚在 asar 内）解析，不暴露给插件代码；本机 profile 的 `node_modules` 顶层没有 `@deepseek-ai`。想在插件里用 zod/schemastery 时，必须把它写进 `dependencies`（pnpm 的 hoisted 布局会提升到 profile `node_modules` 顶层），且那是**第二份**副本，不能拿去 `instanceof` 宿主里的类。详见 `research/sample-plugin.md`。
- `client.js` 的 `require('react')` 由平台共享模块表提供，不要打包 React。
- 本骨架未声明 `engines.dsh`（上架插件市场时补上，装前兼容性预检会读它；不合规时可 `dsh plugin --profile desktop allow-version ... --accept-risk` 授权）。
- **宿主半侧的 `/ctx` 只读不改**：它只调用 `ctx.tokenMeter.measure(session)`。真正会改历史的只有控制半侧，而它只通过官方 `ctx.compaction` 服务操作（`compactNow` / `compactIfNeeded`），从不自己写 `surfaceOp` 或拼接事件。

## 许可

MIT
