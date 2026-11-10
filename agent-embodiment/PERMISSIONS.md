# 权限与数据边界（agent-embodiment）

本文档对应 DSH STORE 权限披露要求：逐项列出插件访问的文件、网络、命令、凭据、Profile/会话与外部服务，并给出触发条件与失败边界。**声明本身不替代商城审阅或独立安全审计。**

## 汇总

| 能力 | 是否使用 | 范围 | 权限档位（商城口径） |
| --- | --- | --- | --- |
| 文件读取 | 是 | 插件自己的状态文件与 profile patch（只读读取 current 值）；经 `sessionQuery` 读取会话事件日志的派生字段（标题、cwd、模型、工具名、用量）；不扫描宿主包源码 | 有界只读 |
| 文件写入 | 是 | `~/.dsh/agent-embodiment/` 下自己的状态与备份；profile 的 `cordis.patch.yml` 仅经官方 `configEditor`；Agent 脚手架写入用户指定的工作区目录 | 插件私有状态 + Profile + 工作区 |
| 网络 | 仅本机同源 | 宿主已有 Web 服务器上注册 `/api/agent-embodiment/*` 路由；浏览器端只 `fetch` 同源 API | 无外发 |
| 命令执行 | 否 | 无 `child_process`、无 Shell、无动态执行外部代码 | 无 |
| 凭据 | 否 | 不读取 API Key、Cookie、Token；插件运行时代码不读取环境变量（`process.env` 只出现在脚手架生成的脚本文本里，插件本身不执行） | 无 |
| 外部服务 | 否 | 无遥测、无 CDN、无第三方端点、无账号体系 | 无 |
| Profile / 会话 | 是 | 经 `tokenMeter.measure(session)` 读取用量；经 `sessionQuery.observeSession` 读取会话事件日志用于跨会话统计与导出（只消费标题/cwd/模型/工具/用量等派生字段，不展示、不上传消息正文）；经 `configEditor` 在用户开启自动压缩时写 preset 的一行 | 敏感持久状态（**high**） |

> 按商城保守口径，本插件因会写 Profile 配置，整体权限等级应视为 **high / user-reviewed**，而不是低风险自动通道。

## 1. 文件访问

### 1.1 不读取宿主官方包源码

- 当前实现不再扫描 `@deepseek-ai/*/lib/`。工具与提示词来源使用稳定的包名映射（`harness:*` → `dsh-system-prompt`、`tools:*` → `dsh-tools` 等），不做宿主路径猜测。
- 因此没有“700 个文件 / 2 MiB”索引，也不读取官方包内容。

### 1.2 读写：插件私有状态

- `~/.dsh/agent-embodiment/session-toggles.json`：按会话保存工具/提示词开关、内联提示词文本、`autoMountControl` 标志。
- `~/.dsh/agent-embodiment/backups/`：每次写入前备份，保留最近 30 份。
- 边界：只写上述路径；不遍历用户目录；不读取消息正文（跨会话统计通过 `sessionQuery.observeSession` 读取事件日志的标题、cwd、模型、工具名与用量等派生字段，fold 过程不保留或输出消息正文）。

### 1.3 经官方 `configEditor` 写 Profile

- 只在两种情况下发生：用户点击「启用自动压缩」，或启动时检测到控制行缺失且 `autoMountControl` 为真。
- 写入内容：profile `cordis.patch.yml` 中的插件 config 行 / `preset-standard` 整段覆盖 / compaction 组内 `agent-embodiment/control` 一行。
- 保护：写前自动备份 `cordis.patch.yml`；桌面版不允许时自动挂载失败不阻塞启动，面板显示原因与手动重试。
- 卸载残留：`dsh plugin remove` 不会清理这些行，仓库提供 `scripts/clean-agent-embodiment-profile-patch.mjs` 清理并备份。

### 1.4 经宿主路由写工作区（Agent 脚手架）

- 触发：用户在面板 Agent tab 点击「生成」，或直接 POST `/api/agent-embodiment/status/scaffold/generate`。
- 位置：用户提交的**绝对** `targetDir` 下的 `.dsh/scaffolds/<slug>/` 与 `.agents/skills/<slug>-*/`。
- 边界：拒绝文件系统根目录和用户 home；默认拒绝覆盖已有文件（`overwrite: true` 才覆盖）；每个目标路径都必须落在 `targetDir` 内（路径穿越校验）。
- 内容：生成 preset patch、Markdown、SKILL.md、eval JSONL、可选 MCP 配置、可选 `AGENTS.md` 标记 section；不写入真实 secret（MCP 的 `${ENV_VAR}` 转为 `!!js process.env.*`）；**不在生成阶段执行任何 MCP 命令**。生成的 preset 安装仍需用户手动执行 `dsh plugin add` 或使用官方插件管理器；安装后 DSH 可能按生成的 MCP 行启动本地命令，这属于用户审查/启用后的行为。

### 1.5 数据导出（由浏览器下载）

- `/api/agent-embodiment/status/export` 返回当前扫描范围内的汇总与会话级字段（`id`、`title`、`cwd`、model、tokens、费用、时间等），CSV 单元格做了公式注入中和（`=`/`+`/`-`/`@` 开头的文本会加前导 `'`）。
- 文件由浏览器下载到本机；插件不上传、不写第三方位置。

## 2. 网络

- **无外发请求**：宿主侧不调用 `fetch`/`http.request` 连接任何外部地址。
- 宿主侧仅在 DSH 已有 Web 服务器上注册本机路由（`/api/agent-embodiment/status|config|live|inventory|prompt`）。
- 浏览器侧 `client.js` 只 `fetch` 同源 API 路径，路径相对 `document.baseURI` 解析，用于读取状态与提交开关/配置；兼容反向代理的路径前缀。
- 无 CDN、无外部脚本、无遥测、无第三方服务依赖。

## 3. 命令、凭据与外部依赖

- 无 `child_process` / `exec` / `spawn` / Shell 命令。
- 无凭据读取：不读环境变量、不读凭据文件、不接触 provider API Key。
- `package.json` 无 `dependencies` 运行依赖；宿主能力全部来自 Cordis 服务（`commands`、`tokenMeter`、`webServer`、`configEditor`、`sessions`）。
- 无 `preinstall/install/postinstall/prepare` 生命周期脚本。

## 4. 已知风险与失败边界

| 场景 | 行为 |
| --- | --- |
| 自动挂载被宿主拒绝（如桌面 profile 由 Electron 独占） | 启动继续，面板提示原因；不阻塞会话，不静默改配置 |
| 压缩后用量未下降 | 记录 `lastError`（before → after），不反复重试、不删会话内容 |
| 写配置/状态失败 | 捕获异常，保留内存态并提示；状态文件用临时文件 + rename 落盘，读失败时回落到最近一份备份 |
| 卸载 | 依赖与 bundles 由 `dsh plugin remove` 清理；patch 残留行用清理脚本移除 |

## 5. 兼容性声明

- `engines.node`：`>=20`
- `engines.dsh`：`>=0.2.0-rc.2 <0.3.0 || 0.2.1-rc.2 || 0.2.1-rc.3`（**只表示安装范围**，不表示逐版本验证过）
- `dsh.compatibility.dshReleases`：`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.5` 标为 `compatible`（均为真实安装/启动验证过的宿主版本）；`0.2.2-rc.1` 标为 `unknown`（集成测试通过，待 Desktop 端到端验收）
- `dsh.compatibility.profiles`：`web`、`desktop`

其他宿主版本未做运行验证，保持 `unknown`，不以范围声明代替真实验收。状态接口的 `compatibility` 字段会把这两层原样下发，面板据此显示“范围满足但未验证”，不把 `unknown` 当成阻断。

## 6. 状态文件位置

- 0.25.0 起：`~/.dsh/agent-embodiment/profiles/<profile>/`（`session-toggles.json`、`onboarding.json`、`compaction-log.jsonl`、`backups/`）。所属 profile 由「哪个 profile 的依赖指向本插件目录」判定；判定不出来时退回共享目录 `~/.dsh/agent-embodiment/`（旧行为）。
- 首次进入 profile 目录时，会把共享目录里的同名状态文件**复制**过去，不覆盖已有文件、不删除旧文件。
- 状态路由的鉴权：有 `webServer` 但没有 `connection` 服务时一律 403（失败关闭）；纯 headless（没有 `webServer`）放行以保持 headless 兼容。
