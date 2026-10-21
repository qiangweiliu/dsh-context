# dsh-context v0.66.1 问题审查报告

审查对象：`dsh-context` 0.66.1（构建于 2026-10-09，`lib/index.js` 3034 行宿主端 + `lib/client.js` 压缩后的浏览器端）
对照环境：本机 `@deepseek-ai/dsh` 0.2.1-rc.1（从 `.probe/asar` 提取的包）
参照：上游仓库当前版本 0.74.0（2026-10-21 发布）与 `docs/compatibility.md`

## 结论摘要

插件主体架构（投影单元、折叠、四个路由、客户端插槽）在 0.2.1-rc.1 上可以运行：事件表、投影契约、`connection.fetch`、`credentials`、`locale`、`configForms`、`inputTriggers` 以及全部用到的插槽名，都在 0.2.1 的源码中核对存在。真正的问题集中在三类：

1. 0.66.1 是一个"已知还有大量未修问题"的旧版本 —— 从 0.67.0 到 0.74.0 的二十多个修复提交，几乎每一个都对应 0.66.1 里仍然存在的缺陷（长会话冻结、重复挂载、反代 404 循环、余额胶囊、全量 DOM 渲染等）。
2. 与 0.2.1-rc.1 的兼容性从未被上游验证（0.74.0 才把 0.2.1-rc.2 纳入矩阵，rc.1 仍不在任何声明里），运行时只在低于 0.1.7-rc.2 时兜底，因此它是"未声明地运行"。
3. 若干独立于版本的工程问题：投影状态无界增长、`__proto__` 工具名可让会话投影永久卡死、模型/压缩用量漏计费等。

## 高优先级问题

### 1. 长会话与多会话场景会冻结主进程（上游 #145，0.70.0 修复）

- `src/host/backfill.ts`（index.js 2402–2491）：打开上下文洞察页时，对每个历史会话执行 `readColdLog` 读取**整份**日志，再同步调用 `cache.coldSnapshot` 折叠。折叠是纯同步循环，会话之间只 `setTimeout(100ms)` 让出一次；实测约 1 秒 / 3 万事件，上百个会话时主进程出现数十秒的高占用窗口。`makeColdReadGate` 只在每个会话**开始前**检查一次堆水位，挡不住单会话内部的长时间同步执行。
- `src/host/detail.ts`（2507–2579）：对非活跃会话的 `/api/dsh-context/detail` 请求，在 HTTP 请求内部同步折叠整份日志（`for (const ev of events) state = applyTimeline(...)`），没有分片让出，也没有按持久化修订号缓存结果；重复打开同一历史会话每次都要重新全量折。
- `trimState`（576–604）没有裁剪 `surface` 和 `callNames`；`applyTimeline` 每个事件都会对 `surface`、`requests`、`events`、`archived`、`fileOps` 做浅拷贝。长会话下这是 O(n²) 的拷贝量，同时内存随消息总数单调增长（只有输出视图受 `maxNodes` 限制）。

上游 0.70.0 的修复方式（2000 事件分片、按持久化修订号缓存 detail、按工作量配额让出）可以直接参考。

### 2. 客户端可能重复挂载（上游 #137，0.69.1 修复）

0.66.1 的 `Fs()` 放置逻辑用 `slots.register` 的**返回值是否为函数**来判断"是否已挂载"，并且没有任何 `slots.entries` 级别的重复防护。同一个包在一次页面里被挂载两次（静态 bundle + 后续激活）时，槽位注册表不会触发同 id 去重，界面会出现两个"上下文"标签；如果某次 mount 没有返回 disposer，切换偏好设置还会再注册一份。

### 3. 反向代理带路径前缀时，所有插件路由 404 并循环重试（上游 #159，0.73.0 修复）

浏览器端四处请求都写成根绝对路径 `/api/dsh-context/{balance,backfill,detail,skills}`（client.js 中可直接搜到）。部署在 `/app/dsh/` 这类被网关剥前缀的路径下时，请求会打到网关根而不是插件路由，全部 404，然后按退避反复重试。0.73.0 改成相对 `document.baseURI` 的写法。本机直连部署不受影响，但远程访问 / 反代场景会踩。

## 中优先级问题

### 4. 兼容性声明与实际运行环境不一致

- `package.json` 的 `dsh.compatibility.dshReleases` 只声明了 `0.1.7-rc.2` 与 `0.2.0-rc.2`；没有 `engines.dsh`（上游 0.73.0 才加，#155）。运行时 `meetsBaseline` 只比较 0.1.7-rc.2 这条下限，**0.2.1-rc.1 会被直接放行**，探测失败时也按"fail open"处理（设计如此，但意味着版本矩阵形同虚设）。
- 上游 0.74.0 的支持矩阵是 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2；**0.2.1-rc.1 本身不在任何版本的支持矩阵里**。rc.1 与 rc.2 的差异没有公开验证记录。
- 已逐项核对存在（0.2.1）：`deriveEventMessage`、`interruptedTurnClosers`、`sessionProjections.register`（`init/apply/wire/stateVersion` 契约）、`connection.fetch.register`、`credentials.resolve`、`inputTriggers.registerSource/matchEnter/onPick`、`locale.register`、`configForms.get/whileServed`、`conversation.view`、`conversation.chat.assistant-actions`、`conversation.input.overlay`、`plugins.bundle.config`、`sidebar.panellist`、`sidebar.right.pane.tab(.title)`、`main`，以及 0.2.1 `SessionEventMap` 用到的全部字段（`usage.inputTokens/cacheReadTokens/...`、`surfaceOp`、`shadowedSeqs`、`shadowedTokenCount`、`tool/ptc-dispatch`、`plan/mode`、`session/end-seed`）。
- 未能核对：`sessionQuery.observeSession(projectionMode)`、`sessionPersistence.open/read`、`sessionProjectionCache.coldSnapshot`（提取的 asar 缺 `dsh-session-query`、`dsh-session-persistence-jsonl` 等包）。如果 0.2.1 里 `coldSnapshot` 被改名，回填会对每个会话打一条警告并跳过，不会崩溃。

### 5. 0.2.1 新增事件没有进入账本

- `compaction/summary` 在 0.2.1 带 `usage?: TokenUsage`，但 `applyTimeline`/`applyActivity` 都只从 `assistant/message` 记账，压缩总结那次模型调用的 token 和费用被漏计。
- 0.2.1 新增 `model/selection` 事件作为模型选择的事实来源；插件仍靠 `request/header` 的 config 差异判断切换，且只在 `reason` 为 `change`/`resume` 时记事件。0.2.1 的 `RequestHeaderReason` 新增了 `"series"`，这类切换不会生成"模型切换"事件。
- `turn/start`/`turn/end`、`image/offload`、`session/title`、`working-directory/change`、`workspace/changes`、`approval/policy` 等新事件均被忽略。`image/offload` 会让已卸载图片仍按卸载前的图片数计价（上游也把这条列为已知限制）。

### 6. 余额胶囊（上游 #176，0.74.0 修复）

`deepseekSectionOf`（2192–2213）在找不到 `llm-deepseek`/`llm-deepseek-api-key` 命名空间时，会把**任意**带 `apiKeyEnv` 的 provider 行当作回退（`shaped ??= value`），于是可能拿别的 provider 的凭据去请求 `/user/balance`；`readBalance`（2268）用 `baseUrl + "/user/balance"` 拼接，自定义 baseURL 带路径（如 `https://x/v1`）时得到 `/v1/user/balance`，接口不存在。0.74.0 改为只读 DeepSeek 平台行、只取 origin。

### 7. `__proto__` 工具名可使投影永久卡死（上游 0.67.0 修复）

`bumpToolTotals`（890–914）先 `Object.hasOwn` 再 `timing.tools[name] = {...}`。工具名恰为 `__proto__` 时赋值改的是原型而不是自有属性，随后 wire schema 校验会拒绝继承键，`apply` 抛错；投影注册表没有错误边界，该会话的单元和推送流会永久卡住（上游原话："left the session's push feed loading forever"）。`callNames[callId]`、`pendingCodeOps[rootCallId]` 用同样的裸键写法，属同一类风险（callId 由宿主生成，实际触发面小）。

### 8. 客户端渲染开销与缓存无界

- 0.66.1 没有渲染窗口化：一个 987 步的会话会为整段历史挂载全部趋势条、文件行、事件行和 DNA 单元。上游 0.73.3 在同类会话上实测挂载约 1.6 万个 DOM 节点、首屏 475–587ms、悬停 30 次产生 30 个长任务；换标签页 5 次堆增长约 18.6MB。
- 详情 payload 缓存是页面生命周期内无界的；详情 store 在最后一个订阅者离开后不停止（0.67.0 修）。价格表 `models.dev` 拉取失败后 `setTimeout` 指数退避重试**永不停止**，即使没有任何订阅者（0.67.0 修）。
- 会话级模态状态 Map（`D`）只增不删。

### 9. 数据归口与口径差异（上游 #172，0.74.0 统一）

0.66.1 的 KPI 带、构成合计、会话准入来自会话级统计，热力图与 7 日图来自 `contextActivity` 日账，两者口径不同；跨日 step 的归属、turn 只记一次等规则在 0.74.0 才统一到"按请求发出日"的日账。节假日的峰谷定价不做区分（上游明确为设计取舍）；人民币固定按 1 CNY = 0.15 USD 换算，汇率变化后估值会偏。

## 低优先级 / 环境相关

- macOS 桌面端洞察页头部不能拖动窗口（#136，0.68.1 修复）；Windows 与网页端不受影响。
- `FIRST_PARTY_SOURCES` 表里的 `lsp → @deepseek-ai/dsh-tool-lsp` 在 0.2.1 依赖清单里不存在（可能是提取不全或该工具已移出主包），归属 chip 可能显示错误来源。
- 客户端会直接从浏览器请求 `https://models.dev/api.json`（价格表），这是一次面向第三方的普通 GET，不携带会话数据，但会暴露 IP 与使用时间；离线或 CSP 受限环境下会走入上面的无限重试。
- `watchStepIdentity` 会给缺少 id 的消息补 `dshctx-<uuid>`，属于对其他插件可见的行为改动（前置拦截 `agent/pre-step`），低风险但值得知晓。
- 安全面本身没有硬伤：四个路由都挂在 DSH 的 `/api` 认证围栏后，非 owner Peer 一律 403；API Key 只在宿主进程内使用，不下发浏览器；客户端唯一的 `dangerouslySetInnerHTML` 是静态 SVG 图标；没有 eval / 动态 innerHTML。

## 建议

1. **升级插件到 0.74.0**：`dsh plugin --profile web update dsh-context@latest`。上面第 1、2、3、6、7、8 项都是 0.67–0.74 已修的明确缺陷。
2. **把 DSH 升到 0.2.1-rc.2**：0.74.0 的支持矩阵才包含 0.2.1 线，rc.1 不在任何版本的验证范围内；留在 rc.1 相当于在未测试组合上运行。
3. 如果必须停留在 0.66.1：避免一次打开包含大量历史会话的洞察页（先升级再回填缓存行）；长会话优先用 `/context` 命令而不是完整 Context 标签；反向代理确认是根路径部署；不要注册名为 `__proto__` 的工具。
4. 需要继续跟进的上游遗留：分片/让出式折叠的上限、压缩总结用量是否入账、0.2.1 事件表继续演进时的回归对照。

## 附：证据与来源

- 本地源码：`.probe/dsh-context/lib/index.js`（行号如上）、`lib/client.js`、`package.json`
- 宿主对照：`.probe/asar/dsh/node_modules/@deepseek-ai`（0.2.1-rc.1 的 `dsh-session`、`dsh-session-projection`、`dsh-client-connection`、`dsh-client-ui-input-trigger`、`dsh-api-remote-access` 等）
- 上游变更：GitHub Releases v0.67.0–v0.74.0；`docs/compatibility.md`（2026-10-21 校验）
