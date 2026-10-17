# 给 DeepSeek Harness 写一个「上下文长度管理」插件：实施方案

> 目标读者：想在 DSH（DeepSeek Harness）里做上下文长度/预算管理的插件作者。
> 全部结论基于本机安装的 DSH（Electron Desktop，profile `desktop`）实测；证据与行号见
> [`research/arch.md`](../research/arch.md)（插件机制）与 [`research/context-core.md`](../research/context-core.md)（上下文/压缩子系统）。

---

## 0. 先认清一件事：底座已经有了，插件不是从零造压缩

DSH 自带一整套上下文管理设施，插件要做的是**在既有 seam 上扩展**，不是自己实现压缩：

| 层 | 现成设施 | 服务/扩展点 | 能否替换 |
|---|---|---|---|
| 计量 | `@deepseek-ai/dsh-token-meter` | `ctx.tokenMeter`（host plane 单例） | 不能，只能消费 |
| 压缩决策+执行 | `@deepseek-ai/dsh-compaction`（seam）+ `dsh-compaction-basic`（默认后端） | `ctx.compaction` | 能，**换后端** |
| 工具结果裁剪 | `dsh-compaction-tool-result-pruner` | `ctx.toolResultPruner` | 能，换服务实现 |
| 溢出兜底 | `dsh-compaction-image-offload` | `/image/offload` 投影 | 只读 |
| 展示 | 3 个 sessionProjection 键 + Web client 插件 | `tokenUsage` / `contextPressure` / `contextBreakdown` | 自由扩展 |

一句话：**「上下文长度管理」= 预算（读 tokenMeter）+ 决策（compaction seam）+ 变换（summarize / pruner）+ 展示（client 插件）**。
你只要挑其中一层介入，不用四层全做。

---

## 1. 机制速览：一次模型请求是怎么组装的

```
session 事件日志 ──deriveMessages()──> frozen messages ──buildRequest()──> system + tools + messages ──> LLM
     ▲                                                                    │
     └────────── surfaceOp:'replace' / compaction 协议才是唯一能改历史的通道 ┘
```

关键约束（`research/context-core.md` §1.3、§5.6）：

1. **没有请求中间件**。messages 每次由 `session.deriveMessages()` 从事件日志派生并 deep-freeze。
2. **`agent/request` waterfall 只能改 config**（provider/model/参数），改不了消息。
3. **`agent/pre-step` 返回的 messages 会被当作「新输入」append 进日志**，不是「改写历史」。
4. 想真正改变模型看到的历史，只有两条合法通道：
   - **压缩协议**：写 `compaction/start` → `surfaceOp:{op:'replace'}` → `compaction/end`（start/end 必须成对，否则锁死为 busy）；
   - **`tool/result` replace + `compaction/prune` 影子价**（pruner 的做法）。
   - 其余「直接改 request body」的做法都会破坏会话回放、分支、KV 记账。

---

## 2. 四条实现路线（按代价从低到高）

### L0 · 纯配置：调内置压缩参数（不写代码）

内置压缩参数由 `dsh-compaction-basic` 的 `Config` 决定（`research/context-core.md` §4.1）：

| 键 | 默认 | 说明 |
|---|---|---|
| `thresholdRatio` | `0.8` | 占窗口多少比例触发压缩 |
| `headroomTokens` | `65536` | 为回复预留的 token |
| `retainRatio` | `0.16` | 压缩后保留最近多少比例 |
| `retainTokens` | — | 保留 token 绝对值（覆盖 retainRatio） |
| `maxTokens` | `headroomTokens` | 摘要输出上限 |
| `compactionRetries` | `1` | 摘要失败重试 |
| `maxOverflowRetries` | `1` | 溢出恢复重试 |
| `summarizationProvider` / `summarizationModel` | 跟随当前 | 摘要用哪个模型 |
| `modelPolicies` | `[]` | 按模型覆盖 |
| `auto` | `true` | 自动触发开关 |

触发阈值 = `min(W * thresholdRatio, W - O - headroomTokens)`，保留预算 = `(W - O) * retainRatio`（W=窗口，O=输出上限）。

**Web 形态的关键坑**：`dsh-web-app` 把 host 平面的 `compaction-basic` / `command-compact` / `tool-result-pruner` 三行设成 `disabled: true`，
真正的实例挂在 `preset-standard` 这个 agent preset 的 `cordis:group`（`isolate: {compaction, toolResultPruner}`）里
（见 [`.probe/asar/.../dsh-web-app/presets/standard.patch.yml`](../.probe/asar/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml) 第 66–82 行）。

所以 **profile 的 `cordis.patch.yml` 里写 `- id: compaction-basic` 打不中 Web 形态**（`billion-context` 的 patch 注释已经踩过这个坑）。
要改参数，必须整行覆盖 `preset-standard`（**config 整体替换，不深合并，必须重述全部 plugins**），或新建一个 preset：

```yaml
# profile/cordis.patch.yml —— 整行覆盖 preset-standard
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      # ↓ 从出货原文完整复制，只改 compaction-basic 这一行
      - id: compaction
        name: cordis:group
        group: true
        isolate: { compaction: true, toolResultPruner: true }
        config:
          - id: compaction-basic
            name: '@deepseek-ai/dsh-compaction-basic'
            config:
              thresholdRatio: 0.7     # ← 你的改动
              headroomTokens: 32768
              retainRatio: 0.1
          - id: command-compact
            name: '@deepseek-ai/dsh-command-compact'
          - id: tool-result-pruner
            name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
            config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
      # ……其余 persona / 工具 / planning / delegation 等 children 必须原样重述……
```

> 出货原文模板见上引 `standard.patch.yml`。也可先 `dsh --profile <非 desktop profile> --dump-config` 导出完整树。
> 每次上游 preset 升级后需重新同步这份快照。

### L1 · 观察 + 软提醒（host plane，最安全，1 天级）

不碰压缩，只做「预算可视化 + 快满时提醒模型/用户」。

- 插入位置：**host plane**（bundle patch `insert` 一行即可）。
- 依赖：`inject = ['sessions', 'tokenMeter']`。
- 能力：
  - `ctx.tokenMeter.measure(session)` → `{ totalTokens, surfaceTokens, nodes[], baseline, surfaceDeltaTokens }`；
  - 注册自己的 `sessionProjections` 键（如 `budgetForecast`）给 Web 面板用；
  - `agent/pre-step` waterfall 里判断「即将超阈值」→ `agent.inject()` 一条提醒（注意：这是 append 新输入，不是改写历史）；
  - `systemPrompt.section()` 加一段静态策略文本。
- 不能做：触发压缩（看不到 preset 内的 `compaction` 服务）、换摘要、裁历史。

### L2 · 换工具结果裁剪策略（preset plane，数天级）

工具结果通常是上下文膨胀的主因，先裁它们性价比最高。

- 插入位置：preset 的 `compaction` isolate 组内，**替换 `tool-result-pruner` 行**为自己实现的 `ctx.toolResultPruner` 服务。
- 契约：`compaction-basic` 在压力确认后会先调 pruner，再决定是否摘要。
- 红线：做 `tool/result` replace 时必须发匹配的 `compaction/prune` 影子价事件，否则 token-meter 的预算判断失真
  （错误信息：`token surface: replace at seq ... has no adjacent shadow price`）。
- 更轻的等价做法：挂 `tools/post-execute`（`spill-policy` 同层）做「工具返回即截断」，完全不碰压缩协议。

### L3 · 换压缩后端（preset plane，重，但这是「真正的上下文管理插件」）

**L3-a：继承 `BasicCompactionEngine`，只覆盖 `summarize()`（推荐起点）**

`dsh-compaction-basic` 的源码注释明确把 `summarize()` 标为唯一子类钩子（`lib/index.js:889-903`）。
继承后，触发阈值、选区（节点 0 保护 + 工具配对平衡）、并发锁、事务、失败码、不变式校验全部复用。

```js
// my-compaction/lib/index.js
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'

export const name = 'my-compaction'

export default class MyCompaction extends BasicCompactionEngine {
  // input = { system?, tools?, messages }（被遮蔽区域的前缀）
  // 返回 { summary, provider, model, maxTokens?, usage?, rawOutput? }
  async summarize(input, agent, signal) {
    return myHierarchicalSummarizer(this.ctx, input, agent, signal)
  }
}
```

约束：返回的 summary 必须让 framed token **小于**被遮蔽内容（否则报 `summary is not smaller than the shadowed content`）。

> ⚠️ **依赖解析实测（重要）**：从 profile 目录用普通 Node 解析 `@deepseek-ai/schemastery` 会 **`ERR_MODULE_NOT_FOUND`**，
> `@deepseek-ai/dsh/package.json` 同样 `MODULE_NOT_FOUND`（本机实测）。也就是说第三方插件**不能裸 import DSH 内部包**。
> 上面这行 `import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'` 只有在以下条件之一成立时才有用：
> ① 用 esbuild/tsup 把该包**打进**你的产物（`billion-context` 就是这么做的：2.3 MB 单文件 bundle）；
> ② 把依赖源码复制进插件目录用**相对路径**引入。
> 纯 JS 骨架请坚持「零 import」——只用 `ctx` 上注入的服务（这也是本仓库 `plugin-skeleton/index.js` 的做法）。

**L3-b：完全自研后端**（继承 `CompactionEngine`，自己实现 `compactIfNeeded` / `compactNow` / `compactRegion`）。
需要正确实现：`compaction/*` 事件、surface replace、影子价（heuristic 与路由价两种口径）、`replaceGeneration` 前进、
工具配对边界、失败闭合。参考实现 `dsh-compaction-basic/lib/index.js:450-675`（事务）与 `:800-1025`（类本体）。

**装配**：Web 形态下必须新建 preset 或整行覆盖 `preset-standard`（见 L0），把你的后端换进 `compaction` 组：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate: { compaction: true, toolResultPruner: true }
  config:
    - id: compaction-advanced
      name: my-compaction          # ← 你的 Bundle 包名
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
```

> 规则：**提供服务的插件必须与所有消费方在同一 realm（同一个 `isolate` 组）**，所以换后端就换在该 `cordis:group` 里。

---

## 3. 插件包的标准结构与最小骨架

DSH 插件 = **Cordis 插件** + 可选 **bundle 补丁** + 可选 **浏览器半侧**。

```
ctx-length/                       # 放在工作区，不要放在 $DSH_HOME 下
  package.json                    # dsh.bundle.patch + dsh.client
  cordis.patch.yml                # insert 一行
  index.js                        # Host 半侧：export apply(ctx, config) + Config + inject
  client.js                       # 浏览器半侧：window.__ModuleLoader__.load({...})
  locale/{zh,en}.json             # 展示元数据 meta.title / meta.description
  icon.svg                        # 可选，≤256 KiB
```

**package.json**

```json
{
  "name": "@local/ctx-length",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-settings"] }
  }
}
```

**cordis.patch.yml**

```yaml
- insert:
    - id: ctx-length
      name: '@local/ctx-length'
      config:
        warnRatio: 0.75
```

**index.js（Host 半侧）**

```js
import z from '@deepseek-ai/schemastery'

export const name = 'ctx-length'
export const inject = ['sessions', 'tokenMeter']   // 硬依赖；可选依赖用 ctx.inject([...], cb)

export const Config = z.object({
  warnRatio: z.number().default(0.75),
  notify: z.boolean().default(true),
})

export function apply(ctx, config) {
  ctx.effect(() => {
    const off = ctx.on('agent/pre-step', async (decision, next) => {
      // 只观察，不拥有决策 → 必须 return next(decision)
      const agent = decision.agent
      if (agent) {
        const m = ctx.tokenMeter.measure(agent.session)
        ctx.logger('ctx-length').info('tokens=%d', m.totalTokens)
      }
      return next(decision)
    })
    return () => off()
  })
}
```

**client.js（浏览器半侧）**

```js
window.__ModuleLoader__.load({
  id: '@local/ctx-length',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    function Panel() {
      return h('div', { style: { padding: '20px 8px' } }, h('h3', null, '上下文长度'))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'ctx-length', order: 100, label: () => '上下文长度' },
            Panel,
          ),
        )
      },
    }
  },
})
```

**依赖解析（实测结论）**

- 从 profile 目录执行 `node -e "import('@deepseek-ai/schemastery')"` → `ERR_MODULE_NOT_FOUND`；
  `createRequire(...).resolve('@deepseek-ai/dsh/package.json')` → `MODULE_NOT_FOUND`。
- 结论：**插件进程里裸 import `@deepseek-ai/*` 不可用**。三种应对：
  1. **零 import**（推荐给纯 JS 骨架）：`Config` 手写 Standard Schema（`{"~standard":{version:1,vendor,validate}}`），
     数据全部从 `ctx` 上的服务拿；
  2. **ESM 打包**：用 esbuild/tsup 把依赖打进单文件（`billion-context` 的做法）；
  3. 把依赖源码复制进插件目录，用相对路径引入。
- 反过来，`ctx` 上的服务（`ctx.tokenMeter`、`ctx.commands`、`ctx.slots`、`ctx.webServer`…）不需要 import，直接可用。

可挂的 slot 是封闭集合：`settings.section`、`settings.plugins.tab`、`settings.onboarding`、`plugins.item`、
`plugins.bundle.config`、`main`、`sidebar.panellist`、`shell.overlay`、`conversation.composer.dock`、`conversation.chat.node`。
面板最省事的是 `settings.section`；已有现成范本可抄：`billion-context`（第三方）与 `dsh-plugin-wallpaper-engine`。

---

## 4. 安装、生效与验证

**安装（两条真实路径）**

1. **Web GUI 插件管理器**（本机 profile 已用过，日志在 `~/.dsh/profiles/desktop/.plugin-manager/logs/`）：
   在设置 → 插件里选择「从本地目录安装」，或让 Agent 调 `plugin_manager` 工具
   `action: install_bundle, target: "<bundle 绝对目录>"`（当前 profile 的 `tool-plugin-manager` 行 `disabled: true`，需先启用）。
2. **CLI**：`dsh plugin --profile desktop add <包名或目录>`（走 pnpm，会写 profile 的 package.json 与 lock）。
   注意：在沙箱内跑会因写 profile 目录报 `EPERM`，需在普通终端或放开权限后执行。

**生效范围**
- Host 插件：装完即通过 HMR 激活（新 JS 模块代需重启）。
- **preset 修改只影响之后新建的会话/Agent**，已有会话保持旧的那份插件。

**验证**
- `plugin_manager` → `list_bundles` 看是否被选中；`list_plugins` 看该行激活状态（`failed` / `overridden` / `restart-required`）。
- 组合结果：`dsh --profile <profile> --dump-config`（`desktop` 由 Electron 独占管理，会拒绝；非 desktop profile 可用）。
- 运行时：新会话里看 `compaction/start|summary|end` 事件与 `trajectory` 面板；设置页应出现你的新分区。

---

## 5. 红线清单（写之前先读一遍）

1. **不要绕过会话日志**改请求体：会破坏回放、分支、KV 记账。
2. **锁**：`compaction/start` 未闭合即 busy；自研后端必须「开始前不 yield、失败恰好闭合一次」。
3. **选区**：必须 `toolPairingBalancedBefore/After`；节点 0（system）绝不可遮蔽；`shadowedRange` 与 `shadowedSeqs` 首尾一致。
4. **影子价格**：任何 surface replace / prune 都要发匹配的 `compaction/summary` / `compaction/prune`，否则预算 delta=0、判断失真。
5. **generation**：自动压缩依赖 `surface.replaceGeneration` 前进才重试。
6. **KV cache**：replace 会作废被遮蔽前缀；摘要调用要复用原 system/tools 前缀，否则每次压缩都贵。
7. **token 低估**：token-meter 用固定 4 字符/token，对中文与 JSON schema 严重低估；阈值必须留 headroom，不要贴边。
8. **Web 与 TUI 平面不同**：同样的 host-plane patch 在 TUI 生效、在 Web 可能无效（实例在 preset 隔离域里）。
9. **不要改用户的 `.dsh` 配置**：插件通过自己的 `dsh.bundle.patch` 声明默认值，用户级覆盖交给 profile patch / 设置页。
10. **不要 append 自定义 type 的 session 事件**：读方只接受带 `ignorable: true` 的未知事件，而 live `Session.append()` 设不了该标记。

---

## 6. 推荐起步顺序

1. **L1 观察面板**（1 天）：`tokenMeter` + `settings.section` 面板 + 阈值提醒。风险近乎为零，先拿到「看得见」的反馈。
2. **L2 裁剪**（数天）：先挂 `tools/post-execute` 做工具结果截断；需要更精细再替换 `toolResultPruner`。
3. **L3-a 摘要后端**（1–2 周）：继承 `BasicCompactionEngine` 只覆盖 `summarize()`，配合新 preset 上线。
4. 全过程用 L0 的参数覆盖调优，把可调值都放进 `Config`，让用户在 `cordis.patch.yml` 里改。

---

## 7. 已交付的骨架与验证证据

[`plugin-skeleton/`](../plugin-skeleton) 是一个**可直接安装运行**的最小骨架（L1 路线）：

| 文件 | 作用 |
|---|---|
| `index.js` | Cordis 插件（宿主侧）：`name` / `inject = ['commands','tokenMeter']` / 手写 Standard Schema 的 `Config` / `apply(ctx, config)`；注册 `/ctx` 命令 + `GET /api/ctx-mon-and-con/status` 只读路由 |
| `control.js` | Cordis 插件（preset 侧，`ctx-mon-and-con/control`）：预算控制 —— `mode: idle` 在轮末调 `compactNow()`、`mode: pre-step` 在 step 边界调 `compactIfNeeded()`、`notify` 只记录；另注册 `/ctx-compact` |
| `client.js` | `window.__ModuleLoader__.load({ id, factory })`，`apply(ctx)` 里 `ctx.slots.inject('settings.section', …)` 注册面板（含控制是否生效的提示） |
| `dsh.bundle.patch.yml` | `- insert: [- id: ctx-mon-and-con, name: ctx-mon-and-con]` |
| `package.json` | `dsh.bundle.patch` + `dsh.client` + `exports`（含 `./control`）+ `files` |
| `locale/{en,zh}.json`、`icon.svg` | 插件管理与设置页的展示元数据 |
| `test/static.mjs` | 30 项纯离线静态检查（导出形状、Config 拒绝非法/未知键、exports、locale、client mock、control 形状） |
| `test/smoke.mjs` | 39 项真实 Cordis 集成冒烟（加载、命令注册与输出、路由 200/405、卸载清理） |
| `test/control.mjs` | 21 项控制半侧测试（idle 超预算压缩、未超预算不动、cooldown、notify、pre-step 调用 `compactIfNeeded` 并继续 waterfall、压缩失败不打断轮次、`/ctx-compact` 成功/失败、卸载清理、`mode: off`） |
| `test/dump-config-smoke.txt` | 隔离 profile 的 `--dump-config` 实证：`# == ctx-mon-and-con` 后跟着插入行 |

实测结果：`node test/static.mjs` **30/30**、`node test/smoke.mjs` **39/39**、`node test/control.mjs` **21/21**、
`node --check` 通过、`--dump-config` 里能看到 `- id: ctx-mon-and-con / name: ctx-mon-and-con`（说明 bundle 组合层真的生效）。

它刻意**不 import 任何 npm 包**。宿主半侧只读测量；控制半侧只在 preset 内挂载后生效，
且只通过官方 `ctx.compaction` 服务（`compactNow` / `compactIfNeeded`）操作，从不自己写 `surfaceOp`。

---

## 8. 参考资料（本机提取，可直接读）

| # | 内容 | 路径 |
|---|---|---|
| 1 | 可安装的最小骨架（L1） | [`plugin-skeleton/`](../plugin-skeleton)（含 README 的装法/验证/限制） |

| 内容 | 路径 |
|---|---|
| 插件机制完整调研 | [`research/arch.md`](../research/arch.md) |
| 上下文/压缩子系统完整调研 | [`research/context-core.md`](../research/context-core.md) |
| 可参考实现分析（billion/ bloom / dshmarket + 装法 + import 结论） | [`research/sample-plugin.md`](../research/sample-plugin.md) |
| 官方插件开发技能（权威） | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/` |
| 官方 preset 组合技能 | `.../skills/editing-cordis-compositions/SKILL.md` |
| patch 方言 + 可安装包清单 | `.../skills/cordis-composition-reference/`（`references/packages.md`） |
| 出货 preset 原文 | `.probe/asar/.../dsh-web-app/presets/standard.patch.yml` |
| 压缩服务/后端文档 | `.probe/asar/.../dsh-compaction/README.zh.md`、`dsh-compaction-basic/README.zh.md` |
| 计量服务文档 | `.probe/asar/.../dsh-token-meter/README.zh.md` |
