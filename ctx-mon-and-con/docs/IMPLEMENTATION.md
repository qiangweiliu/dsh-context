# 实现说明

本文描述 `ctx-mon-and-con` 的内部结构、集成点和验证方式。面向用户的功能说明见 [README.md](../README.md)；约束与已知限制见 [LIMITATIONS.md](LIMITATIONS.md)。

当前版本：`0.19.1`

## 1. 两个半侧

插件由两个 Cordis 插件组成：

| 文件 | 平面 | 作用 |
| --- | --- | --- |
| `index.js` | 宿主平面 | 读取 token 用量、注册 `/ctx` 与状态路由、保存全局配置 |
| `control.js` | agent preset 内 | 执行自动压缩、工具/提示词开关、`/ctx-compact` |
| `state.js` | 共享状态 | 两个半侧共享默认预算、会话覆盖、控制状态 |
| `client.js` | 浏览器平面 | 注册整页面板、设置分区、侧栏 `ctx` 和 composer dock |
| `dsh.bundle.patch.yml` | bundle 层 | 向 profile boot graph 插入插件行 |
| `locale/{en,zh}.json` | 插件市场 | `meta.title` / `meta.description` |

`index.js` 不 import 任何 npm 包；`control.js` 也零 import，只依赖 Cordis 服务。

## 2. 宿主半侧

`index.js` 的 `Config` 使用手写 Standard Schema：

- `contextWindowTokens`
- `warnAt` / `errorAt`
- `triggerAt` / `targetAt`
- `keepTokens`
- `disabledTools`
- `promptOverrides`
- `extraPrompts`
- `extraPromptPlacements`
- `autoMountControl`

注册内容：

- `/ctx`、`/ctx <tokens>`、`/ctx reset`；
- `GET /api/ctx-mon-and-con/status`；
- `/status/live`、`/status/analytics`、`/status/session-detail`；
- `/status/inventory`；
- `/status/inventory/toggle`、`/status/inventory/reset`；
- `/status/inventory/prompt`、`/status/inventory/prompt/reset`；
- `/status/inventory/prompt/session`、`/status/inventory/prompt/session/reset`；
- `/status/inventory/extra-prompt`、`/status/inventory/extra-prompt/reset`；
- `POST /api/ctx-mon-and-con/config`（经 `ctx.configEditor` 写入 profile patch）。

全局配置写入后会触发 Loader 重挂插件。写入对象是 profile 的插件 config 行，不直接改会话历史。

## 3. 控制半侧

`control.js` 必须挂进 agent preset 的 compaction 组：

```yaml
- id: ctx-mon-and-con-control
  name: 'ctx-mon-and-con/control'
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

## 4. 工具与提示词

每次装配时，`control.js` 在 `system-prompt/assemble` waterfall 中：

1. 读取会话级禁用列表、全局 `promptOverrides`、会话文本覆盖；
2. 重建 `result.sections`；
3. 把实际生效的 section 与 token 估算写入 inventory；
4. 记录工具清单。

会话级工具通过 `agent.ctx.tools.restrict({ deny })` 应用；提示词通过过滤 section 应用。

`extraPrompts` 的处理：

- 配置 key 为用户名称；
- 实际 section 名为 `ctx-mon-and-con:extra:<name>`；
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

## 5. 配置写入与备份

全局配置、全局提示词、新增提示词都经 `ctx.configEditor` 写 profile `cordis.patch.yml`。

写操作前自动备份，备份位于：

```text
~/.dsh/ctx-mon-and-con/backups/
```

面板「恢复全部」会清空：

- 会话开关；
- 全局工具禁用；
- 全局提示词覆盖；
- 新增提示词。

## 6. 自动挂载控制行

插件启动时检查 `preset-standard` 的 compaction 组；如果没有 `ctx-mon-and-con/control` 行，就通过 `ctx.configEditor` 写入一行。

面板停用自动压缩时会：

- 移除 preset 行；
- 把 `autoMountControl: false` 写入会话开关状态文件；
- 此后启动不会自动加回。

启用时反向恢复。

注意：写入的是 `preset-standard` 的配置快照；DSH 升级 preset 后需要按新默认重新启用或手工同步。

## 7. 客户端

`client.js` 在 `apply(ctx)` 中注册：

- `sidebar.panellist`：左侧 `ctx` 图标；
- `main`：整页「上下文监控」；
- `settings.section`：设置 → 上下文；
- `conversation.composer.dock`：输入框下方指示器。

客户端只通过状态接口读取数据；新增提示词、全局配置等写入通过宿主路由完成。API 路径相对 `document.baseURI` 解析，兼容反向代理的路径前缀；`apply` 带 window 级幂等守卫，避免同一页面重复挂载出两套导航/设置/dock。

面板监听会话区域 DOM 变化，2 秒节流刷新；空闲时不轮询。

## 8. 安装与卸载内部行为

安装走 DSH 官方插件管理器：

```text
profile package.json dependencies
→ node_modules/ctx-mon-and-con
→ dsh.profile.bundles 追加 ctx-mon-and-con
→ Loader 读取 dsh.bundle.patch.yml
```

本地目录安装会记录为 `link:` 依赖。首次安装与启停由 DSH HMR 热生效：宿主半侧在数秒内挂载，Web 页面会跟随客户端模块图更新；页面没更新时刷新一次即可，不需要重启 DSH。Desktop 0.2.1-rc.2 也已实测：运行中 add/remove 后侧栏与面板即时出现/消失（`EVIDENCE.md` E17）。卸载会从 `dsh.profile.bundles` 移除并热卸载。**替换已安装包（升级版本）仍是例外**：DSH 缓存已挂载包的 manifest 与模块代际，官方要求重启进程。

自动挂载或全局配置写入会在 profile patch 中留下顶层插件行与 preset 行。单纯 `dsh plugin remove` 不会清理这些行；需要时使用仓库脚本：

```bash
node scripts/clean-ctx-profile-patch.mjs ~/.dsh/profiles/<profile>
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
npm test                      # static + metrics + state（不依赖 DSH 运行时）
npm run test:integration      # prepare-deps + control + smoke + prompt-state（需要本机 app.asar）
node --check index.js
node --check control.js
node --check client.js
```

`test/prepare-deps.mjs` 默认读取本机 DSH 的 `app.asar`，可用 `DSH_ASAR` 环境变量指定其他路径。

当前结果：

```text
static       73/73
metrics      23/23
state        16/16
control      54/54
smoke        48/48
prompt-state 11/11
```

UI 证据与历史版本验收见 [EVIDENCE.md](EVIDENCE.md)。

## 10. 兼容性

manifest 声明：

- Node `>=20`
- DSH `>=0.2.0-rc.2 <0.3.0 || 0.2.1-rc.2`
- profiles：`web`、`desktop`

已实测 WSL `dsh 0.2.0-rc.2` 和 Windows Desktop `0.2.1-rc.2`。其他版本保持 `unknown`。
