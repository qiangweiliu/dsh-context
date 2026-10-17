# DSH 上下文长度管理：机制、扩展点与插件方案（调研底稿）

> 调研对象：DeepSeek Harness（DSH）Desktop 打包产物 `C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\app.asar` 内的 `@deepseek-ai/*` 包（版本均为 `0.2.1-rc.1`）。
> 路径缩写：**P** = `C:\Users\40410\Desktop\context\.probe\asar\dsh\node_modules\@deepseek-ai`（已从 asar 解包，可直接读取）。
> 证据约定：**[F]** = 有源码/README/真实配置出处的已验证事实；**[I]** = 由已验证事实推出的推断（未实测）。
> 本文只写事实与可落地方案，不运行 DSH、不改用户 `.dsh` 配置。

---

## 0. 一页结论（给 Lead 的摘要）

1. **DSH 的"发给模型的消息"没有可插拔的请求中间件**：`messages` 每次都由 `session.deriveMessages()` 从事件日志重新派生（`P\dsh-agent-loop\lib\index.js:1274-1288`），并深度冻结；`agent/request` waterfall 只能改 **config**（provider/model/reasoningEffort/maxTokens），改不了 messages（`P\dsh-agent-loop\lib\index.js:1191-1195`）[F]。
2. **"模型可见即已记录"（model-visible is logged）是硬架构约束**（`P\dsh-session\README.zh.md:100`）：要改变发给模型的历史，唯一合法方式是**向会话日志追加事件**，其中只有 `surfaceOp:{op:'replace'}` 能遮蔽旧节点。压缩就是"一条 `user/message` replace + 若干只写日志的 `compaction/*` 事件"[F]。
3. **上下文管理的中心 seam 是 `ctx.compaction`**：`dsh-compaction` 只定义抽象服务（三个操作 `compactIfNeeded` / `compactNow` / `compactRegion`），`dsh-compaction-basic` 是默认后端；加载一个继承 `CompactionEngine` 的插件即"成为该组合的压缩服务"（`P\dsh-compaction\README.zh.md:48-78`）[F]。
4. **默认后端把"策略/触发/选区/事务/锁/不变式"全做完了，只留一个官方推荐的子类钩子 `summarize(input, agent, signal)`**（`P\dsh-compaction-basic\lib\index.js:889-903`，注释原文 "Override this sole hook for a template or remote summarizer."）[F]。→ 做"自己的上下文管理插件"最省力、最不破坏协议的方式是**继承 `BasicCompactionEngine` 只换摘要策略**；要改触发/选区/分代/分层压缩才需要重写三个操作。
5. **计量是独立服务 `ctx.tokenMeter`**（`dsh-token-meter`），`measure(session, requestHeader?)` 返回压力/表层逐节点价格，启发式固定 **4 字符 = 1 token** + 块/角色开销（`P\dsh-token-meter\lib\types\estimate.js:9-13`）[F]；它挂在 **host plane**，提供 3 个 `sessionProjections` 键给 UI，本身无配置、不可替换（服务单例）[F]。
6. **Web 形态下 agent 平面在 preset 里**：`dsh-web-app` 把 host-plane 的 `compaction-basic` / `command-compact` / `tool-result-pruner` 三行 `disabled: true`，改由 `preset-standard` 的 `cordis:group`（`isolate: {compaction, toolResultPruner}`）挂载（`P\dsh-web-app\cordis.patch.yml:536-543`、`P\dsh-web-app\presets\standard.patch.yml:66-82`）[F]。所以**要替换压缩服务，改的是 preset，不是 profile 的 host 行**——这正是 `billion-context` 的 `auto:false` 打不中的原因（其 patch 注释自述见下文 §7.7）[F]。
7. **推荐介入层（按性价比排序）**：① 摘要策略层——继承 `BasicCompactionEngine` 覆盖 `summarize()`，放进 preset 替换 `compaction-basic`（唯一官方钩子，风险最低）；② 工具结果裁剪层——实现 `ctx.toolResultPruner` 服务（被后端在触发后自动调用，`P\dsh-compaction-basic\lib\index.js:926-945`）或挂 `tools/post-execute`（`spill-policy` 同层）；③ 触发/预算层——host 插件监听 `agent/pre-step` / `agent/request-error` + 读 `tokenMeter`，做告警、展示、自定义触发（需先把 `auto` 关掉避免 busy 冲突）；④ 展示层——新 `sessionProjections` 键 + Web client 插件。
8. **不要走的路**：`agent/pre-step` 里改 `messages`（返回的 messages 会被当作新用户输入**写进日志**，`P\dsh-agent-loop\lib\index.js:1061-1073`）[F]；`@messageProjection` 改写普通消息（事件 type 白名单当前只有 `image/offload`，`P\dsh-session\lib\index.js:144`）[F]；原地修改请求 messages（deep-freeze，`P\dsh-agent-loop\lib\index.js:1273-1280`）[F]。

---

## 1. 一次模型请求的组装链路

### 1.1 唯一组装点：`AgentLoopDriver.buildRequest()`

`P\dsh-agent-loop\lib\index.js:1213-1289`。核心返回（`:1274-1288`）：

```js
const boundaryMessages = session.deriveMessages();
for (const message of boundaryMessages) { if (this.frozenMessages.has(message)) continue; deepFreeze(message); this.frozenMessages.add(message); }
Object.freeze(boundaryMessages);
return markAgentLoopRequest(Object.freeze({
  ...header.config,                    // provider / model / reasoningEffort / maxTokens
  messages: boundaryMessages,          // 唯一消息来源
  toolHistory: session.toolHistory(),  // 历史工具声明归约
  ...header.tools !== void 0 ? { tools: header.tools } : {},
  sessionId: this.session.id,
  signal
}));
```

- 请求里**没有**独立 system 字段：系统提示词已作为 `system/message` surface 节点 0 进入 `deriveMessages()`（`P\dsh-system-prompt\README.zh.md:140`）[F]。
- `header` 由 `canonicalHeader({config, adapterDefaults?, tools?})` 生成（`P\dsh-agent-loop\lib\index.js:1217-1221`），并写入 `request/header` 事件（reason: `initial|resume|change|series`，可带 `startsSeries`，`:1224-1240`）[F]。
- 工具增删会写 `developer/message`（tool-addition / tool-removal，带 `surfaceOp:"append"`，`:1241-1259`）[F]。
- 路由元数据写 `request/context`：`{provider, model, contextWindow?, systemPromptUpdate?}`，仅变化时追加（`:1262-1271`）[F]。

### 1.2 扩展点全景（这一步能看见的所有钩子）

| 钩子 | 注册形态 | 载荷/返回 | 能做什么 | 出处 |
|---|---|---|---|---|
| `agent/pre-step` | **waterfall** | payload `{messages, turn, step, signal}`；默认返回 `{kind:'enter', messages}`，可 `{kind:'reject'}`，可带 `startsRequestSeries:true` | 增删"本轮要计入的新用户输入"；决定是否进入这一步；**不能改写历史** | `P\dsh-agent-loop\lib\index.js:909-926`、`:1056` |
| `agent/request` | waterfall | payload `{turn, step, signal}`；返回 **config** | 动态选模型/推理档/maxTokens（不能改 messages） | `P\dsh-agent-loop\lib\index.js:1191-1197` |
| `agent/request-error` | waterfall | `{turn, step, provider, failure, retryPolicy, signal}`；返回 `{kind:'retry'}` 则重试 | 上下文溢出恢复、图片超限重试 | `P\dsh-agent-loop\lib\index.js:1136-1146` |
| `agent/status` | emit | `{agent, status}` | 观察 idle/running | `P\dsh-agent-loop\lib\index.js:798` 附近 |
| `agent/error` | emit | `{turn, step, error}` | 观察 | `P\dsh-agent-loop\lib\index.js:880` |
| `agent/assistant-stream` | emit | `{frame}` | 观察流片 | `P\dsh-agent-loop\lib\index.js:1080` |
| `agent/turn-stopping` | serial | `{turn, signal}` | 轮结束前串行处理 | `P\dsh-agent-loop\lib\index.js:1001-1004` |
| `session/event` | emit（`(session, event)`） | 每个已提交事件 | 观察/驱动增量状态（token-meter 即此） | `P\dsh-token-meter\lib\index.js:697-699` |
| `llm/stream` | waterfall | 已准备好的 request；`ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared))` | 观察/包裹分片流；**不能合法改 messages**（见 §1.3） | `P\dsh-llm\lib\index.js:2397` |
| `compaction/summary-error` | waterfall | `{session, sourceEventSeqs, error, signal?}`，返回 boolean 表示"已记录进展、请重试" | 摘要失败的恢复策略（image-offload 即此） | `P\dsh-compaction-basic\lib\index.js:1017-1022` |
| `ctx.sessions.registerMessageProjection` | 注册 | `{type, project(event, ctx)}` | 事件 → 派生消息的纯改写（受白名单限制） | `P\dsh-session\lib\index.js:1729-1737` |
| `ctx.sessionProjections.register` | 注册 | `{key, stateSchema, apply, wire?}` | 给 UI 的读模型（不参与请求） | `P\dsh-session-projection\README.zh.md` |
| `ctx.systemPrompt.section/variable/suppressRuntimeContext` | 注册 | 提示词段/变量 | 系统提示词内容与预算（**不能压缩节点 0**） | `P\dsh-system-prompt\README.zh.md:54-86` |
| `tools/post-execute` | 钩子 | 工具结果 | 工具输出原地裁剪（spill-policy） | `P\dsh-spill-policy\README.zh.md` |
| `ctx.commands.register` | 注册 | 斜杠命令 | `/compact` 同层，可加自己的命令 | `P\dsh-command-compact\lib\index.js` |

> `waterfall` 语义（`P\cordis\lib\index.js:317-325`）：`waterfall(...args)` 从参数尾部取出 fallback，监听器以 `(...args, next)` 调用，`next()` 依次执行后续监听器并最终落到 fallback；**最外层监听器的返回值就是结果**，监听器不调 `next()` 即短路。`ctx.on(name, fn, options)` 的 options 可为布尔（= `prepend`），因此可抢占顺序（`P\cordis\lib\index.js:335-379`）[F]。

### 1.3 为什么"改写即将发出的消息"不是 middleware

- `deriveMessages()`（`P\dsh-session\lib\index.js:1672-1687`）按 `surface.nodes` 顺序、以 `surface.contentGeneration` 作缓存代次重建；每次返回**新数组**，但消息对象共享且 **deep-frozen**（`:1664-1669`）[F]。
- `buildRequest` 对每条消息再 `deepFreeze` 一次并把数组 `Object.freeze`（`:1273-1280`）[F]。→ 任何"就地改 messages"在运行时都会失败或被忽略。
- `agent/pre-step` 拿到的是 **inbox 里待接纳的新消息**，不是历史：这些 messages 在 `step()` 里被逐条 `session.append("user/message", message, {surfaceOp:"append"})`（`:1067-1073`）[F]。
- 因此**唯一合法改写通道 = 追加带 `surfaceOp` 的 surface 事件**（append 或 replace）。这也是压缩、pruner、image-offload 三个官方"内容变换"插件全部走日志的原因。

---

## 2. 计量层：`dsh-token-meter`

### 2.1 服务接口

`P\dsh-token-meter\lib\index.js:687-700`：

```js
var TokenMeter = class extends Service {
  static Config = z.object({});          // 无任何配置；传 key 直接抛 TokenMeterConfig
  static inject = ["sessionProjections"];
  constructor(ctx, config = {}) {
    super(ctx, "tokenMeter");
    validateConfigKeys(config);
    ctx.sessionProjections.register(tokenUsageProjectionDefinition);
    ctx.sessionProjections.register(contextPressureProjectionDefinition);
    ctx.sessionProjections.register(contextBreakdownProjectionDefinition);
    ctx.on("session/event", (session) => { if (this.states.has(session)) this._sync(session); });
  }
  measure(session, requestHeader) { ... }   // :722-765
  estimateMessage(message) { return estimateMessage(message); }  // :783-785
```

返回快照（deepFreeze + structuredClone，`:757-764`）[F]：

```js
{ logRevision, baseline: {kind:'usage'|'estimated'|'none', tokens, usage?},
  surfaceDeltaTokens, totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens),
  surfaceTokens, nodes: [{seq, tokens, heuristicTokens}] }
```

- `totalTokens` = "请求压力"（含输出/工具 schema 的锚点基线），UI 占用率 = `totalTokens` / 模型上下文窗口 [F，README]。
- `nodes[]` 是当前表层的逐节点价格（`seq` 对应 surface 节点），后端用它做保留预算累加（§4.5）。
- 测量复杂度 O(surface)（每次克隆节点）[F，README]。

### 2.2 启发式估算（固定，不可配）

`P\dsh-token-meter\lib\types\estimate.js`：

```js
const CHARS_PER_TOKEN = 4;   // :9
const BLOCK_OVERHEAD = 4;    // :11
const ROLE_OVERHEAD = 4;     // :13
```

- 文本/推理：`ceil(len/4) + BLOCK_OVERHEAD`；tool-call：`ceil(name/4)+ceil(args/4)+4`；system：`ceil(chars/4)+ROLE_OVERHEAD`；tools schema：`ceil(JSON.stringify(tools).length/4)+4`（`estimateToolsTokens`，`:90-94`）[F]。
- **CJK 与 JSON schema 会被显著低估**（README 明说）[F]。→ 中文场景下阈值实际更晚触发；写插件若在意精度，应只用它做相对比较，或在自有插件里加语言感知系数（但不能替换 meter）。
- 路由定价：适配器声明 `imageRequestPricing(provider, model)` 时，图片按视觉 token + 文本计价；文件按 `llm.fileRequestText(ref)` 句柄文本计价；`image/offload` 到的位置按占位文本计价（`P\dsh-token-meter\README.zh.md`、`lib/index.js:766-776`）[F]。

### 2.3 usage 锚点复用

只有"最新一次成功调用"的规范 envelope 与当前 header 完全相等、且提供方 usage 总量 ≥ 路由重新定价的锚点时，`baseline` 才用真实 usage；否则整包重新估算（`lib/index.js:728-756`）[F]。这意味着：**压缩替换后 `surfaceDeltaTokens` 会重算**，而 baseline 仍可能来自上一次调用的 usage——预算判断不是纯启发式。

### 2.4 已注册的 3 个 UI 投影键（`ctx.sessionProjections`）

| key | 状态形状 | 用途 | 出处 |
|---|---|---|---|
| `tokenUsage` | `{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` | 每轮/会话用量 | README + `lib\index.js:393-447` |
| `contextPressure` | `{pressureTokens?, projectedTokens?, contextWindow?}`（来自最新 `request/context`） | 上下文占用率 | `lib\index.js:448-508` |
| `contextBreakdown` | `{systemTokens, toolsTokens, messageTokens}`（启发式构成） | 占用构成 | `lib\index.js:199-281` |

插件卸载即移除三键；`deriveTurnTokenUsage(events)` 供浏览器折叠整轮用量 [F，README]。

> **结论**：计量层已被 `token-meter` **占满**（host plane 单例服务，服务名 `tokenMeter` 唯一）。新插件只能 **消费** `measure()`/`estimateMessage()` 或 **新增自己的投影键**，不能替换计量实现。

---

## 3. 压缩 seam：`dsh-compaction`（服务定义）

### 3.1 服务与三操作

- 服务名 **`ctx.compaction`**；`CompactionEngine extends Service`，构造函数 `super(ctx, 'compaction')`；抽象方法在 JS 产物中被擦除，语义签名为：
  - `compactIfNeeded(agent, trigger: 'pressure' | 'context-overflow', signal): Promise<CompactionResult | null>`
  - `compactNow(agent, signal, sourceCommandId?): Promise<CompactionResult | null>`
  - `compactRegion(start, end, agent, signal): Promise<CompactionResult>`（seq 为 surface 节点的 inclusive 范围）
  出处：`P\dsh-compaction\lib\index.js`（导出表见下）、`P\dsh-compaction\README.zh.md:48-78`、`P\dsh-command-compact\lib\index.js` 的 `ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)` [F]。

导出（`P\dsh-compaction\lib\index.js`）：

```js
export { CompactionEngine, CompactionEngine as default, CompactionId, ManualCompactionError,
         compactCheckpointSource, isCompactCheckpointSource,
         toolPairingBalancedAfter, toolPairingBalancedBefore };
```

包 exports 另有 `./types`、`./checkpoint`（无 cordis 依赖，客户端可 import）[F，`P\dsh-compaction\package.json`]。

`CompactionResult`（后端提交后的返回值，`P\dsh-compaction-basic\lib\index.js:662-674`）：

```js
{ compactionId, sourceCommandId?, startSeq, summarySeq, summary,
  shadowedRange: {start, end}, shadowedSeqs: [...], shadowedTokenCount }
```

### 3.2 事件协议（全部只写日志，不上表层）

| 事件 | payload | 语义 |
|---|---|---|
| `compaction/start` | `{compactionId, sourceCommandId?, turn}` | 开锁；`turn:null` = standalone（手动） |
| `compaction/summary` | `{compactionId, sourceCommandId?, summary, rawOutput?, llmStreamCall?, shadowedRange:{start,end}, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage?}` | 摘要记录（影子价格来源） |
| `compaction/end` | `{compactionId, sourceCommandId?, turn, error?}` | 释放锁；失败时带 `error` |
| `compaction/prune` | `{shadowedRange:{start,end}, shadowedSeqs:[seq], shadowedTokenCount}`（`shadowedTokenCount = ctx.tokenMeter.estimateMessage(original)`） | 供 token-meter 扣减（pruner 用）[F，`P\dsh-compaction-tool-result-pruner\lib\index.js:159-166`] |

`compaction/*` 事件**不能**出现在表层：`SurfaceEventType` 是封闭联合，`compaction/*` 携带 `surfaceOp` 会被拒（`P\dsh-compaction\README.zh.md:114-120`）[F]。

### 3.3 锁模型

"日志记录的标记对就是锁"：`compaction/start` 在摘要让出控制权**之前**同步追加；`compaction/end` 释放；每次失败恰好一次闭合尝试；闭合失败会故意留下未匹配 `start` 作为 busy 信号（`P\dsh-compaction\README.zh.md:96-100`、`P\dsh-compaction-basic\lib\index.js:434-522`）[F]。
`assertCompactionInactive`/`inspectCompactionEntryState` 反向扫描 seq：最新未匹配 start 且晚于最新 `session/end-seed` → 活动锁 → `ManualCompactionError('busy')`；更早的是陈旧证据 [F，invariant/README]。

### 3.4 表层唯一变更点

成功压缩 = 追加 `compaction/start` → `compaction/summary` → **一条** `user/message` replace → `compaction/end`（`P\dsh-compaction-basic\lib\index.js:628-675`）：

```js
session.append("compaction/summary", { compactionId, summary, ...,
  shadowedRange: { start, end }, shadowedSeqs: [...shadowedSeqs], shadowedTokenCount, provider, model, ... });
session.append("user/message", checkpointMessage, {
  surfaceOp: { op: "replace", startSeq: start, endSeq: end },
  sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs]
});
```

`deriveMessages()` 把摘要渲染为 user 角色消息，被遮蔽节点仍留在原始日志里（回放确定性）[F]。

### 3.5 压缩历史的稳定标记

`P\dsh-compaction\lib\types\checkpoint.js`（可从 `@deepseek-ai/dsh-compaction/checkpoint` 导入）[F]：

```js
const COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: "compact-checkpoint" });
function compactCheckpointSource(compactionId, sourceCommandId) { return Object.freeze({ kind: "compact-checkpoint", compactionId, sourceCommandId }); }
function isCompactCheckpointSource(source) { return source.kind === "compact-checkpoint"; }
```

任何消费方（客户端、展示层、下一个后端）都能识别"这条 user 消息是压缩产物"，无需知道后端是谁 [F，README]。

### 3.6 工具配对边界（改选区/写 replace 必须用）

`toolPairingBalancedBefore(session, seq)` / `toolPairingBalancedAfter(session, seq)`：安全切点不会被"尚未回答的 assistant tool-call"跨越；按表层顺序缓存每切点配对状态，`replace generation` 变化重建缓存；缺失 seq 或孤立 `tool/result` 视为表层损坏（错误串 `tool-pairing balance: surface seq ${seq} not found`、`... no matching tool-call (corrupt surface)`）[F，`lib\types\tool-pairing.js`]。

### 3.7 不变式校验

`P\dsh-compaction\lib\types\invariant.js`：`name='compaction-invariant'`、`inject=['invariants']`，注册到 `ctx.invariants`。校验：
- `shadowedRange:{start,end}` 必须是 `shadowedSeqs` 首尾；
- `shadowedSeqs` 非空且逐项等于当前 surface 的连续 span；
- `shadowedTokenCount` 非负安全整数；
- compactionId / sourceCommandId 跨事件一致；
- 成功的 `end` 之前必须有 `summary`；
- 活动标记对不能跨 `turn/start`/`turn/end`（owner 为 turn 数字或 null）；
- `session/end-seed` 之前的未匹配 start 视为陈旧。

→ 自研后端或自研"非压缩类改写"若复用 `compaction/*` 协议，必须满足这些校验，否则会在 append 时被拒 [F]。

### 3.8 手动失败码（UI 依赖的稳定集合）

`ManualCompactionError` 的 `code`：`busy | cancelled | changed | commit | summary | persistence`，`command-compact` 把每个 code 映射成固定 UI 文案（`P\dsh-command-compact\lib\index.js`）[F]。

### 3.9 KV Cache 影响

替换是把第一条被遮蔽消息起的 KV 前缀作废（README 明示）；摘要调用本身**复用会话自己的 system/tools/消息前缀**，只在末尾追加压缩指令，因此摘要调用命中热前缀（§4.6）[F]。

---

## 4. 默认策略后端：`dsh-compaction-basic`

### 4.1 配置全表（全部可选，未知键加载即抛）

`P\dsh-compaction-basic\README.zh.md` + `lib\index.js:806-818`：

```js
static Config = z.object({
  thresholdRatio: thresholdRatioSchema,          // default 0.8
  headroomTokens: headroomTokensSchema,          // default 65536
  retainRatio: retainRatioSchema,                // default 0.16
  retainTokens: retainTokensSchema,              // default undefined（与 retainRatio 互斥）
  summarizationProvider: summarizationProviderSchema,  // default ''
  summarizationModel: summarizationModelSchema,        // default ''
  maxTokens: maxTokensSchema,                    // default = headroomTokens
  compactionRetries: compactionRetriesSchema,    // default 1（min 0）
  maxOverflowRetries: maxOverflowRetriesSchema,  // default 1（min 0）
  modelPolicies: z.array(modelPolicy),           // default []，每项 {provider, model, ...partialPolicy}
  auto: z.boolean()                              // default true
});
```

校验规则（`resolveConfig`，`lib\index.js:59-87`；`validatePolicy`/`validateSummarizationPair` `:180-206`）[F]：
- 未知键、重复 `modelPolicies` 目标、非法 token 数、`retainRatio` 与 `retainTokens` 同设、`retainRatio >= thresholdRatio` 均抛；
- `summarizationProvider/Model` 必须同时为空或同时非空；
- ratio 必须在 `(0, 1]`。

### 4.2 阈值与保留预算公式

`resolveCompactSpec(policy, contextWindow W, reservedCompletionTokens O)`，`lib\index.js:124-147` [F]：

```js
messageBudget  = W - O;
pressureBudget = messageBudget - headroomTokens;                 // B = headroomTokens
thresholdTokens = Math.floor(Math.min(W * thresholdRatio, pressureBudget));  // :132
retainTokens    = policy.retainTokens === undefined
                ? Math.floor(messageBudget * retainRatio)        // :133
                : policy.retainTokens;
```

默认参数下（W 例如 128K、O=64K）：`messageBudget=64K`，`pressureBudget=64K-64K=0` → 阈值可能被压成极小；因此**默认 `headroomTokens=65536` 对 128K 窗口几乎等于"每轮都压"**，实际部署多半要靠 `modelPolicies` 或改 headroom [I，基于公式与默认值推算，未实测]。
`headroomTokens` 的意图是给"输出+工具 schema"预留余量；报错串：`compaction-basic: ${targetKey} reserves ${reserved} completion tokens of its ${contextWindow}-token context window, leaving no message budget; ...`（`:129`）。

### 4.3 `auto: false` 到底关了什么

constructor（`lib\index.js:824-828`）：

```js
constructor(ctx, config = {}) {
  super(ctx);
  this.config = resolveConfig(config);
  if (this.config.auto) this._registerAutomaticCompaction();
}
```

`auto:false` = **不注册自动 listener 组**（`agent/pre-step` 压力触发、`agent/request-error` 溢出恢复、`agent/status`/`session/event` 计数清理），只保留可被 `/compact`（`compactNow`）和编程接口（`compactRegion`）调用的能力 [F]。它**不会**卸载服务、不会禁用 `/compact`、不会影响摘要能力。

### 4.4 自动流程

`_registerAutomaticCompaction()`（`lib\index.js:834-888`）[F]：

```js
ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
  if (!signal.aborted) try {
    const result = await this.compactIfNeeded(agent, "pressure", signal);
    if (result !== null) logResult(result, "step pressure");
  } catch (error) { /* TargetPressureConfigError 只警告一次；其余 warn 后继续 */ }
  return next();
});
ctx.on("agent/status", ({ agent, status }) => { if (status === "idle") this.overflowRetries.delete(agent); });
ctx.on("session/event", (session, event) => { if (event.type !== "assistant/message") return; const agent = this.overflowAgents.get(session); if (agent !== undefined) this.overflowRetries.delete(agent); });
ctx.on("agent/request-error", async ({ agent, failure, signal }, next) => {
  if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next();
  ... // retries >= policy.maxOverflowRetries → next()
  const generation = agent.session.surface.replaceGeneration;
  result = await this.compactIfNeeded(agent, "context-overflow", signal);
  ... // 只有 replaceGeneration 前进才 return { kind: "retry" }
});
```

`compactIfNeeded`（`:914-961`）[F]：
- 用 `routedTarget(session)`（最新持久 `request/header` 的 provider/model）取策略；无目标返回 null；
- `measurement = ctx.tokenMeter.measure(session)`；
- `const prune = this.ctx.get('toolResultPruner')`；
- **context-overflow 分支**：先 `prune.pruneSession(session)` 重测 → `selectCompactableRange(..., 0)`（retain=0，最大缩减）→ `compactRegion`；
- **pressure 分支**：`ctx.llm.resolveModelInfo(provider, model, signal)` → `info.context` 缺失抛 `compaction-basic: no context capacity for ${targetKey}; configure contextWindow on that adapter model`（`:939`）→ 算 spec → `totalTokens < thresholdTokens` 直接返回 → prune + 重测 → `for attempt <= spec.compactionRetries` 循环选范围→压缩→重测，仍超阈值抛 `compaction still above threshold after N compaction attempts (...)`。

### 4.5 选区算法（`selectCompactableRange`，`lib\index.js:410-433`）[F]

```js
const pricedNodes = measurement.nodes;
if (pricedNodes.length === 0) return null;
const surfaceNodes = session.surface.nodes;
if (surfaceNodes.length !== pricedNodes.length || surfaceNodes.some((seq, i) => seq !== pricedNodes[i]?.seq))
  throw new Error("compaction: token-meter surface does not match the current session surface");
const firstIdx = systemHead(session, surfaceNodes[0]) === undefined ? 0 : 1;  // 节点 0 是系统提示词则永不遮蔽
let accumulated = 0, keepFromIdx = pricedNodes.length;
for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
  accumulated += pricedNodes[index].tokens; keepFromIdx = index;
  if (accumulated >= retainTokens) break;                                   // 从尾部累计保留预算
}
if (keepFromIdx <= firstIdx) return null;
while (keepFromIdx > firstIdx) {                                            // 回退到工具配对平衡边界
  if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx])) break;
  keepFromIdx -= 1;
}
if (keepFromIdx <= firstIdx) return null;
return { start: surfaceNodes[firstIdx], end: surfaceNodes[keepFromIdx - 1] };
```

要点：**永远是"最旧的头部区间"**，保留最新尾部；系统提示词（节点 0）永不被遮蔽；边界必须平衡 [F]。

### 4.6 摘要调用（KV 复用 + 8 段模板）

`summarizeWithLlm`（`lib\index.js:292-338`）[F]：
- 目标解析顺序：配置的 `{summarizationProvider, summarizationModel}` → `agent.session.requestHeader()?.config`（最近一次路由）→ `AgentOptions`；都没有则抛 `no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields`（`:303`）。
- 调用参数含 `toolHistory: agent.session.toolHistory()`、`maxTokens: config.maxTokens`（默认 `headroomTokens`=64K）、`sessionId`、**`purpose: 'compaction'`**、`signal`。
- 输入 = 节点 0 的 system/message + `requestHeader.tools` + 被遮蔽区域的消息 + **末尾追加固定压缩指令 user 消息**（复用 KV 热前缀）。
- 模板常量：`SUMMARY_OPEN_TAG='<compacted-summary>'`、`SUMMARY_CLOSE_TAG='</compacted-summary>'`（`:234-235`）；`COMPACTION_INSTRUCTION`（`:243-278`）要求 8 段结构：Primary Request and Intent / Key Technical Concepts / Files and Code / Errors and Fixes / Pending Jobs / Current Work / Next Step / Critical Context，并**合并 PRIOR checkpoint**；`CHECKPOINT_PREAMBLE`（`:280`）"This is an automatically generated checkpoint ... without acknowledging this checkpoint."
- 只保留文本块：图片 → `UNSUPPORTED_CONTENT`；`frameSummary` = preamble + 开标签 + 摘要 + 闭标签。
- 若 framed 摘要的估算 token ≥ 被遮蔽内容的路由 token → 抛 `summary is not smaller than the shadowed content (${...} estimated framed tokens >= ${...})`（`:601`）[F]。

### 4.7 事务与失败关闭（`compactSurfaceRegion`，`:450-522`）[F]

- 入口先 `validateSurfaceRegion`（`:550-566`，含 before/after 平衡检查；错误串 `compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`）；
- `inspectCompactionEntryState` 后 `assertCompactionInactive`；
- 自动路径要求存在 open turn，否则 `compactRegion: no open turn — automatic compaction events must be enclosed in a turn`（:460）；手动路径要求**没有** open turn（`:456-458`）；
- `compaction/start` 同步 append 后摘要 → `assertStable` → commit → `compaction/end`；
- 失败且未闭合：append 一次带 `error` 的 `compaction/end`；闭合失败保留未匹配 start（busy 证据）；
- 手动失败经 `throwManualFailure` 分类：`commit` / `changed` / `summary`；`flush` 失败 → `persistence`；`busy` 由 `assertCompactionInactive` 与 `compactNow` 的包装给出；
- `compactNow`（`:985-1011`）必须在空闲 agent 的 maintenance 窗口内，否则 `ManualCompactionError("busy", "manual compaction requires an idle agent with no waking queued work")`。

### 4.8 唯一子类钩子：`summarize()`

`lib\index.js:889-903`（原文注释）[F]：

```js
/**
 * Summarize the replayed conversation region through a direct one-shot
 * `ctx.llm.stream()` call whose prefix reuses the conversation's own system
 * prompt, tools, and messages so the provider's KV cache is not invalidated.
 * Override this sole hook for a template or remote summarizer.
 */
async summarize(input, agent, signal) {
  const target = conversationTarget(agent);
  const config = target === undefined ? this.config : resolveTargetPolicy(this.config, target);
  return summarizeWithLlm(this.ctx, config, input, agent, signal);
}
```

`regionDependencies()`（`:1012-1024`）把它动态绑定进事务：`{meter: ctx.tokenMeter, summarize: (input, owner, abort) => this.summarize(...), recover: (...) => ctx.waterfall("compaction/summary-error", {...}, () => false)}`。→ **继承 `BasicCompactionEngine` 并覆盖 `summarize`，即可完整保留触发/选区/锁/不变式，只替换"怎么摘要"** [F + 官方 README]。

### 4.9 已知限制（README 明示）[F]

压缩面向**用户命令**而非模型工具；无法拆分不可分单元（如单条巨大 tool result）；无法缩减系统提示词/工具/会话前缀；摘要质量受模板约束；替换会让被遮蔽前缀的 KV 复用失效。

---

## 5. 内容变换的五条真实通道

### 5.1 通道 A：压缩协议（surface replace）——官方主通道

见 §3。要求：`compaction/start`+`/summary`+`/end` 锁、平衡选区、节点 0 保护、`shadowedTokenCount` 影子价格、可选 `sourceCommandId`。**任何想改历史内容的插件，最安全是复用这套协议**（可借用 `@deepseek-ai/dsh-compaction` 的导出与 helper）。

### 5.2 通道 B：`compaction/prune` 影子价格 + `tool/result` replace（pruner 的做法）

`dsh-compaction-tool-result-pruner`：服务 **`ctx.toolResultPruner`**（`ToolResultPruner`），方法 `pruneSession(session)` / `pruneContent(...)` / `measureContent(...)`；Config `{thresholdChars: 8192, headChars: 4096, tailChars: 1024}`（字符 = Unicode 码点，head+marker+tail ≤ threshold，未知键构造即拒）[F，README + base patch]。
工作方式：只由压缩后端在触发后调用；把超预算的 `tool/result` 以**新追加的 `tool/result`**（`surfaceOp:{op:'replace'}` + `sourceEventSeqs` 指向原事件）替换，紧前追加 **`compaction/prune`** 影子价格事件供 token-meter 扣减；标记文本 `\n\n[... tool result middle pruned ...]\n\n`；非文本块保持相对位置；替换记录失败则同步失败 [F]。

逐事件代码如下（`P\dsh-compaction-tool-result-pruner\lib\index.js:159-177`，已核对原文）[F]：

```js
session.append("compaction/prune", {
  shadowedRange: { start: seq, end: seq },
  shadowedSeqs: [seq],
  shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original)
});
const replacement = session.append("tool/result", { ...event.data, message }, {
  surfaceOp: { op: "replace", startSeq: seq, endSeq: seq },
  sourceEventSeqs: [seq]
});
```

`shadowedTokenCount` 用的是**启发式** `estimateMessage`（不是路由价），与摘要的 `shadowedRouteTokenCount` 口径不同——自研插件若复刻必须注意这一差异（token-meter 的 claim 会用它扣减表层价）。
→ **可替换点**：若你在 preset 内提供一个同名服务 `ctx.toolResultPruner`，`compaction-basic` 会在每次触发时调用你（`lib\index.js:926-945`）。

### 5.3 通道 C：`@messageProjection`（当前被 image/offload 独占）

`ctx.sessions.registerMessageProjection({type, project})`（`P\dsh-session\lib\index.js:1729-1737`）[F]：

```js
registerMessageProjection(projection) {
  if (this.projections.some((item) => item.type === projection.type))
    throw new Error(`session message projection "${projection.type}" is already registered`);
  return this.ctx.effect(() => { this.projections.push(projection); return () => { ... }; }, "sessions.registerMessageProjection()");
}
```

限制（全部 [F]）：
- `MESSAGE_PROJECTION_EVENT_TYPES = new Set(["image/offload"])`（`:144`）；事件类型未注册投影就 fold 会抛 `session event "<type>" requires a message projection; load its owning plugin or supply its projection definition`（`:440`）。
- 注销已被使用的投影后继续派生会抛 `session message projection "<type>" was removed or replaced; restore the session with its owning plugin`（`:584`）。
- 投影只改**派生内容**、不改 surface 节点成员与消息身份；会推进 `contentGeneration`（`:469-472`）。

→ 目前**没有**给第三方留"任意消息改写的投影位"；除非容器新增事件类型，否则此通道不可用于通用上下文改写。**不要把插件建立在它上面**。

### 5.4 通道 D：工具执行后裁剪（spill-policy 同层）

`dsh-spill-policy`：Config `{maxInlineTokens}`（省略=禁用；base 配 12500）；监听 `tools/post-execute`（prepend 注册，先 `next()` 再限制）与 `tools/ptc-dispatch-log`；文字+图片共享估算 token 预算，保留首尾、落 spill 文件并在结果里写 `<spill notice>`（`./notice` 导出 `formatSpillNotice`/`hasSpillNotice`）；复用 token-meter 的估算与模型 `imageRequestPricing`；失败保留原内容 [F，README]。
→ 这是"入口侧"（工具刚返回时）裁剪，**不产生撤销/回放问题**（工具结果本身仍按原样入日志，除非它改写 append）。适合做"单条工具结果预算策略"。

### 5.5 通道 E：系统提示词段（`ctx.systemPrompt`）

`dsh-system-prompt` 提供 `ctx.systemPrompt` 注册表：`section({name, order, text})`、`variable(name, fn)`、`suppressRuntimeContext()`、`toolOrder` 配置；组装经 `system-prompt/assemble` waterfall（带作用域）；渲染后的提示词作为 `system/message` surface 节点 0 或"历史内更新"的新系统节点 [F，`P\dsh-system-prompt\README.zh.md:54-86,131-140`]。
→ 可用于"加预算说明/换 persona/裁剪运行时上下文"，但**不能压缩节点 0**（压缩器明确不遮蔽它），也不能减少工具 schema（那是 tools registry 的事）。

### 5.6 这些不是通道（重要负面结论）

| 尝试 | 为什么不行 | 出处 |
|---|---|---|
| `agent/pre-step` 返回改过的 messages | 返回的 messages 是"待接纳的新输入"，会逐条 `user/message` append 进日志 | `P\dsh-agent-loop\lib\index.js:1061-1073` |
| `agent/request` 返回 messages | 该 waterfall 契约只返回 config，`buildRequest` 自己 `deriveMessages()` | `P\dsh-agent-loop\lib\index.js:1191-1195`、`:1274` |
| `llm/stream` 里改 request.messages | messages 已被 deep-freeze；监听器只应观察/包裹 stream | `P\dsh-agent-loop\lib\index.js:1273-1280`、`P\dsh-llm\lib\index.js:2397` |
| 在内存里维护"压缩后消息数组"直接喂模型 | 违反"模型可见即已记录"，重放/持久化/分支会不一致 | `P\dsh-session\README.zh.md:100` |
| 用 `@messageProjection` 改普通消息 | 事件 type 白名单当前只有 `image/offload` | `P\dsh-session\lib\index.js:144` |

### 5.7 手动触发面

- `/compact`（`dsh-command-compact`）：`inject=["commands","compaction"]`，无参数，调 `ctx.compaction.compactNow(agent, signal, commandId)`，`command/run`/`command/done` 仅日志，`command/done.sourceEventSeq = result.summarySeq` [F，lib]。
- 编程 API：`ctx.compaction.compactRegion(start, end, agent, signal)`（需要 open turn，owner="current-turn"）；`compactNow`（需要空闲 agent）。插件可加自己的 `ctx.commands.register(...)`。

---

## 6. 周边压缩相关插件逐个说明

| 包 | 解决的问题 | 服务/钩子 | 配置 | 可替换/禁用/叠加 |
|---|---|---|---|---|
| `dsh-compaction` | 定义 seam（无策略） | 提供 `ctx.compaction` 抽象类 | 无 Config | 被后端继承；客户端可 import `./checkpoint` |
| `dsh-compaction-basic` | 默认策略+LLM 摘要 | 提供 `ctx.compaction` 实例；监听 pre-step/request-error | §4.1 全表 | **可整体替换**（换 name 行）；**可子类化**覆盖 `summarize` |
| `dsh-compaction-tool-result-pruner` | 大工具结果中部裁剪 | 提供 `ctx.toolResultPruner` | `thresholdChars/headChars/tailChars` | 可替换（同名服务）；可禁用 |
| `dsh-compaction-image-offload` | 图片预算溢出时省略最老图片 | 注册 `imageOffloadProjection`；`agent/request-error` 处理 `IMAGE_OFFLOAD_REQUIRED`；`compaction/summary-error` 参与恢复 | 无 | host plane；与压缩后端叠加 |
| `dsh-command-compact` | 人类 `/compact` | `ctx.commands` + `ctx.compaction.compactNow` | 无 | 可禁；与后端无关 |
| `dsh-spill-policy` | 工具结果落盘 + 内联预算 | `tools/post-execute`、`tools/ptc-dispatch-log`；`ctx.get('spillLocal')` | `maxInlineTokens` | host plane；与压缩叠加 |
| `dsh-output-retention` | **纯库**（非 cordis 插件）：head/tail 保留、截断提示 | 被工具实现直接 import | 无 | 不是插件，不能经 cordis.yml 挂载 |
| `dsh-session-projection` | **客户端读模型注册表**（非消息派生） | `ctx.sessionProjections.register` | 无 | 用于展示层 |
| `dsh-session-turn-outline` | 会话轮次大纲（展示） | sessionProjections | — | 展示层参考 |

`dsh-session-projection` 关键澄清 [F]：它**不组装请求、不注册模型可见内容**，只把事件折叠成 wire 可传的 UI 读模型；模型 messages 的派生在 `dsh-session`（§1）。`ProjectionDefinition = {key, stateSchema, stateVersion, init(header, inheritedEventCount), apply(state,event), wire?{viewSchema, view}}`；`apply` 必须同步、无关事件必须返回同一引用；注册返回 fiber-owned disposer；`Object.is` 门控避免无谓发布。

---

## 7. 装配：这些插件实际挂在哪里（真实配置层）

### 7.1 组合（composition）的三层来源

`C:\Users\40410\.dsh\profiles\desktop\cordis.yml` 的真实内容是注释 + `[]`，注释原文 [F]：

> "dsh profile root — an empty entry list. The tree is composed as patches: each bundle in package.json's `dsh.profile.bundles`, then `cordis.patch.yml`, then any `--patch` overlays. Edit cordis.patch.yml, not this file."

→ 组装顺序：**各 bundle 的 patch（按 `dsh.profile.bundles` 顺序）→ profile 的 `cordis.patch.yml` → `--patch` overlay**。profile patch 最后应用，优先级最高（对能被 id 命中的行）[F]。

### 7.2 `dsh-base` 里与上下文相关的行（`P\dsh-base\cordis.patch.yml`）

| 行 id | 包 | 配置 | 行号 |
|---|---|---|---|
| `token-meter` | `@deepseek-ai/dsh-token-meter` | （无） | 348-349 |
| `compaction-basic` | `@deepseek-ai/dsh-compaction-basic` | （无，即默认 auto:true） | 351-352 |
| `command-compact` | `@deepseek-ai/dsh-command-compact` | （无） | 356-357 |
| `spill-local` | `@deepseek-ai/dsh-spill-local` | （无） | 411 |
| `spill-policy` | `@deepseek-ai/dsh-spill-policy` | `maxInlineTokens: 12500` | 414-417 |
| `session-checkpoint-policy` | `@deepseek-ai/dsh-session-checkpoint-policy` | （无） | 420-421 |
| `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | `thresholdChars:8192, headChars:4096, tailChars:1024` | 425-430 |
| `image-offload` | `@deepseek-ai/dsh-compaction-image-offload` | （无） | 434-435 |
| `system-prompt` | `@deepseek-ai/dsh-system-prompt` | `personaPrefix: ''`（由 web-app 覆盖） | 497-500 |
| `agent-loop` | `@deepseek-ai/dsh-agent-loop` | `agents: []` | 504-507 |

文件头语义 [F]：**"A patch replaces the targeted row's whole `config` rather than merging into it"**；"Row order carries no load semantics (activation is service-availability driven)"。

### 7.3 `dsh-web-app` 把 agent 平面挪进 preset（Web 形态的关键）

`P\dsh-web-app\cordis.patch.yml` [F]：

```yaml
- id: compaction-basic
  disabled: true          # :536-537
- id: command-compact
  disabled: true          # :539-540
- id: tool-result-pruner
  disabled: true          # :542-543
```

注释（:529-534）：**token-meter 留在 host plane**，因为它拥有 context-meter 的 projection units，而该表是进程级的，preset 拥有会让 meter 变成"挂了哪些 preset"的函数。
另：`- insert: [- id: agent-preset-registry, config: {default: standard}]`（:582-586）；preset 声明在 `presets/*.patch.yml`，由 `package.json` 的 `dsh.bundle.patch` 数组列出 [F]。

真实 preset（`P\dsh-web-app\presets\standard.patch.yml:66-82`）[F]：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

含义 [F + I]：
- `isolate` 让 `compaction` / `toolResultPruner` 服务成为**该组内的独立实例**，跨 preset 不共享；host plane 上的同名 provider 不会作用到 preset 内的 agent [I，基于 cordis isolate 语义与 web-app 注释]。
- 所以：**在 Web profile 里想换压缩实现，必须改 preset（或新建 preset），在 host plane 插入同名服务是无效的**。

### 7.4 用户 profile 现状（已验证）

- `C:\Users\40410\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 顺序 [F]：
  `@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-web-app` → `@deepseek-ai/dsh-experimental-voice-input-bundle` → `@deepseek-ai/dsh-experimental-auto-review` → `@deepseek-ai/dsh-experimental-agent-team-profile` → `dshmarket` → `billion-context` → `dsh-bloom-theme`。
- `cordis.patch.yml` 真实内容（4 条：`agent-default-model` → deepseek-account/deepseek-flash/reasoningEffort high；`ui-settings-account`；`ui-chat`；`ui-settings`）[F]。文件头说明它是 "top-level YAML array of loader patch entries (id-targeted config overrides, disables, and insert lists; `!!js` expressions allowed)"。
- 第三方包只在 profile 的 node_modules；`@deepseek-ai/*` bundle 由 asar 提供 [F]。

### 7.5 bundle patch 格式与语义（写插件必读）

一个"bundle"就是带 `dsh.bundle.patch` 的 npm 包（`P\dsh-package-manifest\README.zh.md`、`billion-context/package.json`）[F]：

```json
{ "name": "my-context-plugin", "version": "0.1.0", "type": "module", "main": "lib/index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

patch 文件是 loader patch 数组，三种条目 [F]：
- `- insert: [ {id, name, config?, disabled?}, ... ]`：向当前树插入行（可插入 preset 声明或普通插件）；
- `- id: <loader-row-id>` + `config:`：**整体替换**该行 config（不深合并）；
- `- id: <loader-row-id>` + `disabled: true`：禁用该行。
`!!js` 表达式只在插件配置或 `disabled` 中求值；行缺失只警告不失败（`billion-context` 注释）[F]。

### 7.6 为什么 `billion-context` 的 `auto:false` 打不中（真实实例分析）

`C:\Users\40410\.dsh\profiles\desktop\node_modules\billion-context\dsh.bundle.patch.yml` 原文 [F]：

```yaml
- insert:
    - id: bili-native
      name: billion-context
- id: compaction-basic
  config:
    auto: false
- id: llm-deepseek
  config: { retryPolicy: { mode: normal, retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, MALFORMED_RESPONSE] } }
- id: llm-deepseek-account
  config: { retryPolicy: { ... } }
```

其注释自述 [F，原文]："the `auto: false` below targets the HOST-PLANE compaction-basic row. In profiles bundling @deepseek-ai/dsh-web-app that row is disabled and the running instance lives inside the preset-standard entry, which this bundle layer cannot address by id — switching off auto-compaction there needs a profile-level full-snapshot override of preset-standard (config replaces wholesale; see the plugin's boot warning / #2474)."
→ 结论：想在 Web profile 关掉默认自动压缩，**必须覆盖 `preset-standard` 整行 config（重述全部 children）**，或在 UI 换一个不含 `compaction-basic` 的 preset [F+I]。
（注：`dsh-agent-preset` 的官方 skill 说 bundle patch 也可以按行 id 覆盖 shipped preset、并需重述完整 config，见 §7.8；这与 billion-context 的"bundle 层无法按 id 寻址"表述存在冲突，实践上以 profile patch 覆盖最稳，见 §9 未解问题。）

### 7.7 配置如何暴露给用户/UI

- 每个插件的 `Config` 是 schemastery schema，由 loader 在激活时校验（`compaction-basic` 的未知键/非法值会直接抛）[F]。
- `dsh-settings` + `dsh-config-editor`：settings 表单按 profile 条目 id 定位插件，只展示 `.volatile()` 字段，编辑结果**写回当前 profile 的 cordis patch**（`ctx.configEditor.edit()`）；普通字段仍通过 Cordis 配置/Patch 编辑；home patch 与 `--patch` 优先级更高，会被覆盖的写入直接拒绝 [F，`P\dsh-settings\README.zh.md:26-39`、`P\dsh-config-editor\README.zh.md`]。
- **没有**专门针对 compaction 家族的设置页：已提取的 client 包中只有 agent-loop / subagent / web-search / account / models / general / plugin-inventory 等官方配置页；`dsh-client-ui-agent-preset` 只做只读 YAML 查看（`agentPresets/read`）+ 预设选择 + 创造入口 [F，包清单与 README]。
- 因此 compaction 的调参路径是：**改 `cordis.patch.yml`（或 bundle patch / 创造模式改造 preset）**；Web 的"内置插件"页只列清单，配置页由各官方插件的伴生包注册（`plugins.item` slot / `settings.plugins.tab`）[F，`P\dsh-client-ui-settings-plugins\README.zh.md`]。
- 工具面：`plugin_manager` 的 `install_bundle` / `list_bundles` / `list_plugins`；`cordis_inspect_query` 的 `Config.listConfigs` 可读某行插件的 `packageDir` 与 Config schema [F，`dsh-agent-preset/skills/...`]。安装 bundle 会执行 Host 进程代码，需要 Full access 或审批。

### 7.8 官方 skill 给出的 preset 覆盖写法（`dsh-agent-preset/skills/editing-cordis-compositions/SKILL.md`）[F]

> "Override the declaration by its Loader row id instead of inserting. The override replaces the complete `config`, so restate `id`, `plugins` and every other field the shipped file carries."

```yaml
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      # 出货列表 + 你的改动（例如把 compaction-basic 换成自己的后端，或加 config: {auto: false}）
```

同 skill 还规定：**"A preset plugin that supplies a service must isolate the provider and all its consumers in the same realm. A service consumed by Host plugins belongs in the Host configuration."** → 压缩后端（服务 `compaction`）必须和它的消费者（`command-compact`、pre-step 监听器）在同一个 `isolate` 组里。

### 7.9 可直接抄的 patch 片段

**(a) 关掉 host plane 的自动压缩（非 Web / TUI 形态有效）**

```yaml
# profile/cordis.patch.yml
- id: compaction-basic
  config:
    auto: false
```

**(b) 调默认后端参数（host plane 生效时；config 整体替换，需重述所有想保留的键）**

```yaml
- id: compaction-basic
  config:
    auto: false
    thresholdRatio: 0.7
    headroomTokens: 32768
    retainRatio: 0.1
    summarizationProvider: deepseek-account
    summarizationModel: deepseek-flash
    maxTokens: 16384
    compactionRetries: 2
    maxOverflowRetries: 2
```

**(c) Bundle 插入 host-plane 新插件（不替换服务、只观察/展示/策略）**

```json
// my-context-budget/package.json
{ "name": "my-context-budget", "version": "0.1.0", "type": "module", "main": "lib/index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

```yaml
# my-context-budget/cordis.patch.yml
- insert:
    - id: my-context-budget
      name: my-context-budget        # 从 profile 的 node_modules 解析
```

**(d) 用自己的后端替换 preset 里的 compaction-basic（Web 形态，完整快照式覆盖）**

```yaml
# 放在 bundle 的 cordis.patch.yml（或 profile 的 cordis.patch.yml）
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      # ... 其余 children 必须原样重述（persona / agent-instructions / 工具 / planning / delegation ...）...
      - id: compaction
        name: cordis:group
        group: true
        isolate: { compaction: true, toolResultPruner: true }
        config:
          - id: compaction-advanced
            name: my-compaction-backend      # 你的 CompactionEngine 子类
          - id: command-compact
            name: '@deepseek-ai/dsh-command-compact'
          - id: tool-result-pruner
            name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
            config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

（`plugins` 必须完整；`P\dsh-web-app\presets\standard.patch.yml:10-128` 是出货原文模板。）

**(e) 新建一个自带上下文策略的 preset（改动面最小、最不容易踩坑）**

```yaml
- insert:
    - id: preset-mycontext
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: mycontext
        name: My Context
        order: 20
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config: { prefix: 'You are a coding agent powered by the {{model}} model.' }
          - id: compaction
            name: cordis:group
            group: true
            isolate: { compaction: true, toolResultPruner: true }
            config:
              - id: compaction-advanced
                name: my-compaction-backend
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
          # ... 其余工具 children 按 standard 复制 ...
```

安装（两条真实路径）[F]：`dsh plugin --profile desktop add <pkg|dir>`，或 `plugin_manager` 工具 `action: install_bundle, target: <绝对 bundle 目录>`；默认值可在设置 → Agent preset 或 `agent-preset-registry` settings 命名空间改。

---

## 8. 写"自己的上下文长度管理插件"：介入层分析（核心建议）

### 8.1 四层模型与占用情况

| 层 | 对应包/服务/事件 | 现状（谁占着） | 还剩多少空间 |
|---|---|---|---|
| **① 预算计算层**（多长算满、构成、占用率） | `ctx.tokenMeter.measure()`（host plane，单例）；`ctx.sessionProjections`（host） | `token-meter` 完全占用服务本身；3 个 UI 键已注册 | **只能消费 + 加自己的投影键**；精度问题（CJK 低估）无法通过替换解决，只能补偿 |
| **② 触发决策层**（何时压、压多少、失败怎么办） | `agent/pre-step`（waterfall）、`agent/request-error`（waterfall）、`agent/status`、`session/event`；`ctx.commands` | `compaction-basic` 在 `auto:true` 时占住自动触发；`command-compact` 占住 `/compact` | **可加监听器（waterfall 多监听器、可 prepend）**，但与默认自动路径会争锁（busy）；要独占须先 `auto:false`（需改 preset）。命令可自加 |
| **③ 内容变换层**（改什么、怎么改） | 压缩协议（`compaction/*` + surface replace）；`ctx.toolResultPruner`；`tools/post-execute`；`@messageProjection`（关闭）；`ctx.systemPrompt` | `compaction-basic` 的选区/摘要；`tool-result-pruner` 服务；`spill-policy` 钩子；`image-offload` 投影 | **`summarize()` 是官方留白（最大空间）**；`toolResultPruner` 服务可整体替换；`tools/post-execute` 可叠加；`@messageProjection` **无空间**；系统提示词段可加但压不了节点 0 |
| **④ 展示层**（给用户看预算/压缩结果） | `sessionProjections` 键 + Web client 插件（`plugins.item`/`settings.plugins.tab`）；`trajectory` 已展示 compaction 记录与 token 用量 | `contextPressure`/`contextBreakdown`/`tokenUsage` 三键；`ui-chat` 用量卡片；`trajectory` | **自由**：加自定义键 + 自己的卡片/页面，风险最低 |

### 8.2 方案 L1（最轻，1 天级）：预算观察 + 自定义策略提示（host plane）

- 插入位置：host plane（bundle patch `insert`）。
- 依赖：`inject = ['sessions', 'tokenMeter']`（`tokenMeter` 是 host 服务）。
- 能做的事：监听 `session/event`（收到 `assistant/message` 即一次完整请求）→ `tokenMeter.measure(session)` → 记录占用趋势；注册自己的 `sessionProjections` 键（如 `budgetForecast`），供客户端展示；在 `agent/pre-step`（waterfall）里做"即将超过 X% → 写一条 `developer/message` 提醒模型精简输出"（注意：必须 append 事件，不能改 messages）。
- 不能做的事：直接触发压缩（看不到 preset 内的 `compaction` 服务）；替换摘要；裁剪历史（除非自己实现压缩协议）。
- 适用：想要"预算可视化 + 软提醒"，不改压缩行为。

### 8.3 方案 L2（中，数天级）：替换工具结果裁剪策略（preset plane）

- 插入位置：preset 的 `compaction` isolate 组内，**替换 `tool-result-pruner` 行**。
- 实现：`class MyPruner { pruneSession(session){...}, pruneContent(...), measureContent(...) }` 并作为插件提供服务名 `toolResultPruner`；`compaction-basic` 会在压力/溢出确认后先调用它（`lib\index.js:926-945`），之后才摘要。
- 好处：**不改压缩事务**，只缩小被压缩体的输入；对 KV cache 影响局部可控（替换早期尾部工具结果）。
- 注意：替换必须自己发 `compaction/prune` 影子价格事件（否则 token-meter 不扣减，阈值判断会失真——见 `P\dsh-token-meter\lib\types\surface-projection.js` 的 claim 逻辑与错误 `token surface: replace at seq ... has no adjacent shadow price`）[F]。
- 也可只做 `tools/post-execute`（spill-policy 同层）实现"工具返回即裁剪"，完全不碰压缩协议。

### 8.4 方案 L3（重，推荐用于"真正的上下文管理插件"）：替换压缩后端

**L3-a 最小改动：继承 `BasicCompactionEngine`，只覆盖 `summarize()`**

```js
// my-compaction-backend/lib/index.js（示意；import 路径取自 packages/compaction/compaction-basic）
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import { createUserMessage } from '@deepseek-ai/dsh-session';   // 视包导出而定

export const name = 'my-compaction-backend';
export const inject = ['llm', 'tokenMeter', 'sessions'];

export default class MyCompaction extends BasicCompactionEngine {
  // 继承全部 Config 字段（schemastery 会沿用父类 Config，如框架支持）；也可显式重述
  async summarize(input, agent, signal) {
    // input = { system?, tools?, messages } —— 被遮蔽区域前缀（见 buildSummarizationInput）
    // 返回 { summary, provider, model, maxTokens?, usage?, rawOutput?, llmStreamCall? }
    return myHierarchicalSummarizer(this.ctx, input, agent, signal);
  }
}
```

优点：触发（阈值/headroom/modelPolicies）、选区（节点 0 保护 + 工具配对）、锁、事务、失败码、不变式全部复用；只需保证返回的 summary 让 framed token **小于**被遮蔽内容（`summary is not smaller than the shadowed content` 检查在 `lib\index.js:601`）。
用途：分层/多代摘要、外部摘要服务、结构化摘要模板、按轮次合并（billion-context 类产品思路）。

**L3-b 完全自研后端**：继承 `CompactionEngine`，实现 `compactIfNeeded` / `compactNow` / `compactRegion`，自己写 `compaction/*` 事件、surface replace、`shadowedTokenCount`（heuristic 与路由价两种口径），可选实现 `ctx.toolResultPruner` 协作。要求：并发锁语义、`turn` 归属、`surface.replaceGeneration` 前进判断、工具配对边界、失败闭合。参考实现就是 `P\dsh-compaction-basic\lib\index.js:450-675`（事务/提交）与 `:800-1025`（类本体）。

### 8.5 安装与生效路径（Web profile）

1. 写 npm 包（`type: module`、`main: lib/index.js`、`dsh.bundle.patch`）。
2. 二选一：
   - **新建 preset**（推荐）：patch 里 `insert` 一个 `@deepseek-ai/dsh-agent-preset` 声明，把 `compaction` 组换成你的后端；然后在 设置 → Agent preset 里选它（或把 `agent-preset-registry` 的 `default` 改成你的 id）。
   - **覆盖 `preset-standard`**：profile 或 bundle patch 里 `- id: preset-standard` + 完整 `config.plugins`（§7.6、§7.9d）。
3. 安装：`plugin_manager` `install_bundle`（走 pnpm + 组合校验）或 `dsh plugin --profile desktop add`；安装后 `plugin_manager/list_plugins` 确认 `preset-<id>`/行状态，新会话才生效（preset 修改只影响之后创建的 Agent——`P\dsh-agent-preset\README.zh.md:12`）[F]。
4. 验证：`cordis_inspect_query` 读 Config schema；`list_plugins` 看激活状态；新会话里看 `compaction/start` 日志与 `trajectory` 面板 [F/I]。

### 8.6 风险与红线清单

1. **不要绕过日志**：任何"直接改 request"的方案都会与持久化/回放/分支/KV 记账冲突（§5.6）。
2. **锁**：`compaction/start` 未闭合就是 busy；自研后端必须"start 之前不 yield、失败恰好一次闭合"（§3.3）。
3. **选区**：必须 `toolPairingBalancedBefore/After`；节点 0（system）绝不可遮蔽；`shadowedRange` 必须与 `shadowedSeqs` 首尾一致，否则 invariant 拒写（§3.7）。
4. **影子价格**：凡做 surface replace 或 prune，必须给 token-meter 提供匹配的 `compaction/summary`/`compaction/prune` 影子事件，否则 `replace` 的价格 delta=0、预算判断失真（`surface-projection.js`）[F]。
5. **generation**：自动压缩依赖 `surface.replaceGeneration` 前进才 retry；自研后端忘记推进会导致溢出恢复死循环或误判。
6. **KV cache**：replace 会作废被遮蔽前缀；摘要调用要复用原 system/tools/消息前缀（后端已如此），否则每次压缩都很贵。
7. **token 低估**：4 字符/token 对中文与 JSON schema 低估明显；阈值策略要留 buffer（headroom）而不是贴边。
8. **Web 与 TUI 的平面差异**：同样的 host-plane patch 在 TUI 生效、在 Web 无效（preset 隔离）；发布插件要么只支持一种形态，要么同时写两份 patch [I，基于 §7.3]。
9. **不修改用户 `.dsh` 配置**：插件应当只通过 bundle 的 `dsh.bundle.patch` 声明默认值；用户级覆盖交给 profile patch / 设置页。

---

## 9. 事实/推断分界与未解问题

**已验证 [F]（有源码或真实配置出处）**：§1 请求组装与所有事件名/输运、§2 token-meter API 与启发式、§3 compaction 服务与事件协议/锁/invariant/错误码、§4 basic 后端全部配置/公式/流程/模板/钩子、§5 各通道可行性与限制、§6 各插件职责、§7 全部真实配置行与 patch 语义。

**推断 [I]**：
- "host plane 的 `compaction` provider 不会作用于 preset 内 agent"——由 cordis `isolate` 语义与 web-app 注释推出，未实测；
- 默认参数（W=128K、O=64K）下阈值趋近 0，实际部署需要调 headroom——按公式推算，未实测；
- 新建 preset 后设为默认的具体 UI 操作路径——按 `dsh-client-ui-agent-preset` README 的 `agentPresets/list` + `agent-preset-registry` settings 推出，未在 GUI 点过；
- bundle patch 能否直接覆盖 `preset-standard`：官方 skill 说可以（§7.8），`billion-context` 注释说 bundle 层不行（§7.6）——**两者冲突，需实测**；稳妥做法是写进 profile 的 `cordis.patch.yml`（最后应用）。

**未解/待验证**：
1. ~~`compaction/prune` 精确 payload~~ → **已在本轮补验为 [F]**：`{shadowedRange:{start,end}, shadowedSeqs, shadowedTokenCount}`，见 §3.2 与 §5.2（出处 `P\dsh-compaction-tool-result-pruner\lib\index.js:159-166`）。
2. `BasicCompactionEngine` 的 `static Config` 在子类中是否自动继承（schemastery/Cordis 框架行为）——写 L3-a 前需验证；若不继承需重述整个 schema。
3. `ctx.compaction` 的精确 TypeScript 签名：**asar 内未包含任何 `.d.ts`**（`.probe\all-files.txt` 中 `.d.ts` 条目数为 0，`dsh-compaction-basic/lib` 只有 `index.js`），因此本文签名是从后端实现 + README 反推的服务契约；精确类型需查源码 checkout 的 `packages/compaction/compaction/src/index.ts`。
4. `dsh-session-turn-outline` / `trajectory` 的展示层接入方式（若做展示型插件需要）——本轮未展开。
5. `session-checkpoint-policy`（base :420）与本主题的关系（durability checkpoint，非上下文压缩）——未展开。

---

## 附录 A：事件速查

| 名称 | 形态 | 载荷 → 返回 | 出处 |
|---|---|---|---|
| `agent/pre-step` | waterfall | `{messages, turn, step, signal}` → `{kind:'enter', messages, startsRequestSeries?}` / `{kind:'reject'}` | agent-loop :909-926 |
| `agent/request` | waterfall | `{turn, step, signal}` → config | agent-loop :1191-1195 |
| `agent/request-error` | waterfall | `{turn, step, provider, failure, retryPolicy, signal}` → `{kind:'retry'}`？ | agent-loop :1136-1146 |
| `agent/turn-stopping` | serial | `{turn, signal}` | agent-loop :1001-1004 |
| `agent/status` / `agent/error` / `agent/assistant-stream` | emit | `{status}` / `{turn,step,error}` / `{frame}` | agent-loop :798/:880/:1080 |
| `session/event` | emit | `(session, event)` | session 全包 |
| `llm/stream` | waterfall | prepared request → 分片流 | dsh-llm :2397 |
| `compaction/summary-error` | waterfall | `{session, sourceEventSeqs, error, signal?}` → boolean | basic :1017-1022 |
| `tools/post-execute`、`tools/ptc-dispatch-log` | 钩子 | 工具结果 | spill-policy |
| `system-prompt/assemble`、`system-prompt/change` | waterfall / emit | 提示词组装 | system-prompt |

## 附录 B：配置键速查

| 插件 | Config 键 | 默认 |
|---|---|---|
| `dsh-compaction-basic` | `thresholdRatio` | 0.8 |
| | `headroomTokens` | 65536 |
| | `retainRatio` | 0.16（与 retainTokens 互斥） |
| | `retainTokens` | undefined |
| | `summarizationProvider` / `summarizationModel` | `''` / `''`（或最近路由） |
| | `maxTokens` | = headroomTokens |
| | `compactionRetries` | 1 |
| | `maxOverflowRetries` | 1 |
| | `modelPolicies` | `[]`（`[{provider, model, ...partialPolicy}]`） |
| | `auto` | true |
| `dsh-compaction-tool-result-pruner` | `thresholdChars` / `headChars` / `tailChars` | 8192 / 4096 / 1024 |
| `dsh-spill-policy` | `maxInlineTokens` | 省略=禁用；base 配 12500 |
| `dsh-token-meter` | 无 | — |

## 附录 C：关键文件索引

- 请求组装：`P\dsh-agent-loop\lib\index.js:902-927`（pre-step）、`:1043-1173`（step）、`:1136-1146`（request-error）、`:1175-1212`（prepareRequest）、`:1213-1289`（buildRequest）
- 消息派生：`P\dsh-session\lib\index.js:1672-1687`（deriveMessages）、`:1694-1696`（deriveEventMessage）、`:1729-1737`（registerMessageProjection）、`:144`（event type 白名单）、`:440`/`:584`（错误）
- 计量：`P\dsh-token-meter\lib\index.js:687-700`、`:722-765`；`lib\types\estimate.js:9-94`；`lib\types\route-pricing.js`；`lib\types\surface-projection.js`
- 压缩 seam：`P\dsh-compaction\lib\index.js`；`lib\types\checkpoint.js`；`lib\types\tool-pairing.js`；`lib\types\invariant.js`
- 默认后端：`P\dsh-compaction-basic\lib\index.js:59-206`（config/校验）、`:234-338`（模板/摘要）、`:388-433`（选区）、`:450-675`（事务/提交）、`:800-1027`（类本体）
- pruner：`P\dsh-compaction-tool-result-pruner\lib\index.js`
- image-offload：`P\dsh-compaction-image-offload\lib\index.js`、`lib\types\index.js`
- spill-policy：`P\dsh-spill-policy\lib\index.js`、`lib\types\{notice,retention}.js`
- command-compact：`P\dsh-command-compact\lib\index.js`
- 投影注册表：`P\dsh-session-projection\lib\index.js`、`lib\types\index.js`
- 系统提示词：`P\dsh-system-prompt\lib\index.js`、`README.zh.md`
- 组合与 patch：`P\dsh-base\cordis.patch.yml`、`P\dsh-web-app\cordis.patch.yml`、`P\dsh-web-app\presets\{standard,cordis,minimal,ptc}.patch.yml`、`P\dsh-agent-preset\skills\editing-cordis-compositions\SKILL.md`、`P\dsh-agent-preset\README.zh.md`
- 用户 profile：`C:\Users\40410\.dsh\profiles\desktop\cordis.yml`（空列表）、`cordis.patch.yml`、`package.json`、`node_modules\billion-context\dsh.bundle.patch.yml`
