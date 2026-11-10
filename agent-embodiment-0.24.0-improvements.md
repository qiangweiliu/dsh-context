# agent-embodiment 0.24.0 提升点分析

日期：2026-11-10
对象：`agent-embodiment/`（`package.json` 0.24.0，工作区最新提交 `01af6e0`）
参照：RELEASE-PLAN / LIMITATIONS / CORE-FUNCTION-AUDIT / PERMISSIONS / CI 配置，以及本机 DSH 运行时

## 0. 本次核验（先给结论）

工程基本盘是扎实的：单元 306 项（static 95 / metrics 35 / state 18 / scaffold 146 / insights 12）与集成 137 项（control 54 / smoke 72 / prompt-state 11）全部通过，`node --check` 通过，`npm pack --dry-run` 为 20 个文件、163.2 kB、退出码 0。**没有发现会让插件整体失效的 P0 代码缺陷。**

需要提升的点集中在四类：发布与分发（npm 仍未发布、0.24.0 未推送）、兼容矩阵滞后（本机运行时已是 DSH 0.2.2-rc.1）、权限披露与实现口径不一致、少量可靠性/安全细节与测试工程化。下文按优先级列，均附证据。

## 1. P0：发布与分发（直接阻塞用户获取）

### 1.1 `agent-embodiment` 尚未发布到 npm

- 证据：`npm view agent-embodiment` 返回 404；仓库 RELEASE-PLAN §7 记录 2026-10-24 因 2FA 暂停发布，此后无发布记录。
- 影响：市场 PR #9029 已于 2026-10-24 合并（GitHub API 确认 `merged: true`），但用户按包名安装会 404，只能走 git 安装（需要 allowBuilds 授权），与市场"一条命令安装"的推荐路径不符。插件 README 目前也**没有安装命令**章节，只有"安装后何时生效"。
- 建议：发布 0.24.0 到 npm（`npm publish --access public`，2FA 就绪后）；插件 README 增加安装/升级/回滚命令；市场条目同步 0.24.0 描述；补 `screenshots.json`（市场新版截图机制，当前仓库没有该文件，截图都散在 `docs/ui/`）。

### 1.2 0.24.0 提交未推送到 GitHub

- 证据：`origin/main` 停在 `a958590`，本地 `main` 领先 1 个提交（`01af6e0 feat(0.24.0): 产品补齐…`）。
- 影响：远端没有 0.24.0 源码，tag、市场、issue 引用都会指向旧版本。
- 建议：`git push origin main`，再打 `v0.24.0` tag（tag 建议随 npm 发布一起做）。

### 1.3 兼容矩阵没覆盖 0.2.2-rc.1，而 `engines.dsh` 会自动放行它

- 证据：`E:\tool\dsh\resources\app.asar` 里的 desktop-runtime 已是 **0.2.2-rc.1**（cordis 4.1.0、cosmokit 1.9.0）；而 `dshReleases` 只列了 0.2.0-rc.2 / 0.2.1-rc.2 / 0.2.1-rc.3。DSH 的兼容判定是 `semver.satisfies(version, range, { includePrerelease: true })`（`dsh-app-boot` 源码），所以 `>=0.2.0-rc.2 <0.3.0` 会把**所有** 0.2.x 预发布都算作满足，包括没测过的 0.2.2-rc.1 和未来的 0.2.1-rc.4。
- 影响：与 RELEASE-PLAN 自己定的规则（"未跑通 smoke/control/prompt-state + 一次真实安装之前，不把版本写进 dshReleases"）自相矛盾；用户装到未验证运行时不会有任何提示。
- 已做的验证：我用该 asar 解出的 Cordis 4.1.0 跑了 control / smoke / prompt-state，**全部通过**（54/54、72/72、11/11），说明宿主 API 面基本兼容；但还没有真实安装 + 面板点击验收。
- 建议：在 0.2.2-rc.1 上做一次隔离 `DSH_HOME` 安装与 UI 验收，通过后补进 `dshReleases`；把 `engines.dsh` 收窄成显式枚举（或 `<0.2.2` 再逐条追加），别再依赖宽区间。

### 1.4 发布前还缺一次真实端到端验收

- 证据：RELEASE-PLAN §10 自列六项待办（Desktop/Web 安装、引导三出口、真实压缩、CSV 导出核对等）；EVIDENCE 停在 E31（静态/集成），没有 0.24.0 的 UI 证据。
- 建议：按 §10 逐项执行并补 E32；重点是"引导三出口 × onboarding.json × control.active 一致"和 CSV 列与 `metrics.js` 口径一致。

## 2. P1：正确性、安全与信任

### 2.1 PERMISSIONS 的披露与实现不一致（商城审核风险）

- 证据：PERMISSIONS 汇总表写"Profile / 会话：经 `tokenMeter.measure(session)` 读取 token 用量"，1.2 节写"不读取会话正文内容（只通过 tokenMeter 拿计数）"。实际 `index.js:1074` 通过 `sessionQuery.observeSession` 读取**整份事件日志**交给 `foldSession`，读取范围包括会话 `title`、`cwd`、模型/provider、工具名、压缩记录与用量；`/status/export` 的 CSV/JSON 还把这些字段导出到浏览器。另外"源码中无 process.env 引用"也不准确（`scaffold.js` 的生成模板里包含 `process.env` 文本）。
- 影响：这是权限披露文档，不是普通说明；与实际行为不符会在商城复核或用户质疑时直接失分。
- 建议：按"读取哪些字段、是否离开本机、是否落盘"重写 PERMISSIONS，明确"读取事件日志的派生字段（title/cwd/model/tools/usage），不展示或上传消息正文；导出仅浏览器本地下载"。

### 2.2 CSV 导出存在公式注入风险

- 证据：`index.js` 的 CSV `escape` 只处理 `"`、`,`、换行；单元格若以 `=`、`+`、`-`、`@` 开头，Excel/WPS 会按公式解析。`title`（来自 `session/title`）和 `cwd` 是内容相关字段。
- 影响：用户在自己机器上打开导出文件时，恶意/异常会话标题可能触发公式或 DDE。
- 建议：对以 `= + - @ \t \r` 开头的单元格加前导 `'`，或统一使用 `="..."` 仅限非文本列；加一条 metrics/static 断言。

### 2.3 状态文件非原子写，损坏后不回落备份

- 证据：`session-toggles.json`、`onboarding.json`、`compaction-log.jsonl` 均为直接 `writeFileSync`（`index.js:445-539`）；`loadSessionToggles`/`loadOnboarding` 解析失败只 warn，不读取 `backups/` 里的最新副本。压缩日志的截断重写同样不是原子操作。
- 影响：断电/崩溃/磁盘满会留下半截 JSON，下次启动静默丢失全部会话开关（备份存在但不会被自动使用）。
- 建议：写临时文件 + `renameSync`（DSH 的 `dsh-atomic-write` 就是这个模式，可照抄最小实现）；解析失败时自动回退到最新 `.bak` 并告警；onboarding 也纳入备份。

### 2.4 超时的会话观察不会释放

- 证据：`observeFold` 用 `withTimeout(sessionQuery.observeSession(...), 4000, ...)` 做超时，但 `observeSession` 未收到 `signal`；超时后 promise 继续执行，迟到的 observation 没有 `[Symbol.dispose]()` 路径。
- 影响：大日志/慢盘场景下每次超时都遗留一个会话观察句柄；页面反复刷新会累积。
- 建议：传 `AbortController.signal`，超时即 abort；并在迟到 settle 的 `finally` 里 dispose。

### 2.5 安全审计停留在 0.21.0

- 证据：`docs/security-audit.md` 头部版本 0.21.0；0.24.0 新增的 `/status/insights`、`/status/onboarding`、`/status/export`、`/status/data/reset` 与导出/清理逻辑不在审计范围内。
- 建议：更新到 0.24.0（写操作清单 + 新路由的数据边界），并把它列为 1.0 门禁的"独立审查"输入。

### 2.6 鉴权对"有 webServer 无 connection"的形态放行

- 证据：`authed` 在 `connection` 缺失时直接放行（设计为 headless 兼容，`index.js:770-789`）。
- 影响：如果某个 profile 同时挂了 webServer 但没挂 client-connection（自定义组合可以做到），所有状态/写路由将无鉴权。
- 建议：检测到 `webServer` 存在而 `connection` 缺失时默认 403，只在显式 headless（无 webServer）时放行。

## 3. P2：工程化与可维护性

### 3.1 测试体系可以再工程化一档

- 现状：306 + 137 项全绿，但测试是自研 runner；`static` 里约 37 处是对源码字符串的 `includes/match` 断言（重构即误报）；没有覆盖率统计；集成测试需要本机 `app.asar`，**CI 只跑单元**。
- 建议：CI 增加集成档——`@deepseek-ai/cordis` 与 `cosmokit` 在 npm 上公开（当前 4.1.0 / 1.9.0），按矩阵钉版本（0.2.0/0.2.1 线用 4.0.5/1.8.6，0.2.2 线用 4.1.0/1.9.x）后跑 control/smoke/prompt-state；加 `c8` 覆盖率门槛；把关键字符串断言改成行为断言。

### 3.2 版本号多副本、无自动化

- 现状：`package.json`、`client.js` 的 `CLIENT_VERSION`、根/插件 README、IMPLEMENTATION、EVIDENCE、CHANGELOG、submission yml、`locale/*.json` 分别手改；static 只断言其中两处。
- 建议：加 `scripts/bump-version.mjs`（一次改全部副本）并在 static 中断言所有副本一致；发版流程里先跑它再 `npm test`。

### 3.3 无 lint / format / typecheck

- 现状：仓库没有任何 linter/formatter 配置，CI 只做 `node --check`。
- 建议：加 oxlint（零配置、快）与 prettier check；对 `client.js` 这类 4000 行文件，规则化比人肉 review 更稳。

### 3.4 `client.js` 仍是 4053 行单文件

- 现状：RELEASE-PLAN 已把它列为 1.0 前的技术债（"拆模块已延后"）。本次 0.24.0 还发生过一次文本改写损坏、靠会话日志重放恢复的事故（E31）。
- 建议：按 tab/卡片拆成 `src/client/*` 模块并保留现有 harness；拆分前先加一条"文件哈希/关键渲染快照"回归断言，避免拆分本身成为风险。

### 3.5 没有更新提示

- 现状：面板能检测宿主/客户端版本不一致，但不知道 npm/市场有没有新版本；用户只能自己去查。
- 建议：复用 `engines.dsh`/`dshReleases` 与 npm registry 做一次 1 小时 TTL 的"有新版本"胶囊（参考上游 dsh-context 0.74 的 `useNewerVersion` 做法），失败静默、不阻塞渲染、不在 `-dev` 构建里请求。

### 3.6 价格表靠手工日期

- 现状：`PRICING_UPDATED_AT = 2026-10-24` 是手写常量，官方调价后插件不会提示。
- 建议：在 health/insights 里加"价格表已超过 N 天未更新"提示；或把来源 URL 与日期一起放进设置页展示。

### 3.7 客户端错误隔离与可访问性

- 现状：DSH renderer 对每个 slot entry 有 ErrorBoundary（组件抛错会整块变成空 face），面板内没有再包卡片级边界；`aria-*`/键盘语义覆盖有限（约 20 处）。
- 建议：面板内给主要卡片包轻量 ErrorBoundary；tab 补 `role=tablist/tabpanel` 与方向键切换。

### 3.8 性能基线缺失

- 现状：analytics 冷缓存时一次最多读 40 份**整日志**（并发 4，TTL 20s），大日志下的耗时/内存没有度量；RELEASE-PLAN 把"analytics 性能基线"列为 1.0 门禁。
- 建议：加 `scripts/bench-analytics.mjs`（固定夹具日志，记录 P50/P95 与峰值 RSS），结果写入 docs；在 LIMITATIONS 写明"单次分析的内存与事件数上限"。

## 4. 已知设计债（继续按原计划收敛即可）

- 跨 profile 共享状态目录（P2-3）、control 行 `maxContextTokens` 被宿主默认值遮蔽（P2-1）、全局工具禁用两层实现（P2-2）——CORE-FUNCTION-AUDIT 已记录，1.0 前收敛。
- 若要在 1.0 保留"只承诺有证据"的定位，建议把 `engines.dsh` 的宽区间与 `dshReleases` 的矛盾一起解决（见 1.3）。

## 5. 建议执行顺序（两周粒度）

1. **本周**：`git push` + 打 tag；npm 发布 0.24.0；README 补安装节 + `screenshots.json`；市场条目更新。
2. **随后**：0.2.2-rc.1 隔离安装 + UI 验收，更新 `dshReleases` 与 `engines.dsh`；补 E32。
3. **四个小 PR**：PERMISSIONS 重写、CSV 公式注入、原子写 + 备份回退、observeSession 超时释放。
4. **CI 一档**：集成测试（npm 版 cordis/cosmokit 矩阵）+ 覆盖率 + oxlint/prettier。
5. **0.25.0 规划**：client 拆分、更新提示、价格表时效、性能基线。

## 6. 证据清单（本次实测）

- 单元：`npm test` → static 95/95、metrics 35/35、state 18/18、scaffold 146/146、insights 12/12。
- 集成：`DSH_ASAR=E:\tool\dsh\resources\app.asar node test/prepare-deps.mjs` 后 control 54/54、smoke 72/72、prompt-state 11/11（宿主 0.2.2-rc.1、Cordis 4.1.0）。
- 语法：`node --check index.js control.js client.js` 通过。
- 打包：`npm pack --dry-run` 20 个文件、163.2 kB、退出码 0。
- 外部状态：npm `agent-embodiment` 404；market PR #9029 已合并（2026-10-24）；`origin/main = a958590`，本地领先 `01af6e0`。
