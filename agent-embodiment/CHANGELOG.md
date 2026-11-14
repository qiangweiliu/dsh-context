# Changelog

格式参考 Keep a Changelog；版本遵循 SemVer。DSH 兼容版本写在每个条目的 Compatibility 下。

## [0.29.0] - 2026-11-14

### Added

- **节假日表可配置**：新增配置 `holidays`（`YYYY-MM-DD` 数组，最多 400 条）与 `holidaysIgnoreBuiltin`（布尔）。默认与内置表**合并**，跨年只需在 `cordis.patch.yml` 里补新日期，不必改代码发版；`holidaysIgnoreBuiltin: true` 时完全用配置表。重复日期自动去重排序，非法格式在校验层拒绝。
- 状态接口的 `pricing.holidays` 暴露 `{ builtin, custom, ignoreBuiltin, total }`；设置页的模型价格卡只读展示「内置 N 天 + 自定义 M 天 = T 天」，忽略内置时加标注。

### Changed

- `metrics.js` 新增 `configureHolidays()` / `holidayInfo()`；`isPeakTime()` 默认使用「内置 ∪ 配置」的当前集合，逐条成本估算与 `estimateInputCost` 共用同一判定。

### Compatibility

- `0.2.2-rc.1` 由 `unknown` 改为 `compatible`：隔离实例验收（独立 npm 安装目录、独立 `DSH_HOME`、独立 profile、端口 3081）启动成功，状态接口返回 `version: 0.29.0`，面板四 tab 渲染、0 error / 0 exception。

## [0.28.0] - 2026-11-14

### Changed

- **`client.js` 拆分源码 + 轻量构建**：源码按功能拆到 `client-src/`（11 个片段：header / 词典 / 样式 / 核心 / dock / inventory / sections / charts / scaffold / panel / apply），`npm run build:client` 按固定顺序拼回单文件 `client.js`。发布物仍是单文件——DSH 浏览器侧只加载一个 `client.js` 且只能 `require('react')`，没有打包器可用。
- `scripts/bump-version.mjs` 同时改写片段与产物里的 `CLIENT_VERSION`，避免拆开后版本号漂移。

### Added

- `test/client-build.mjs`（6 项）：字节级防漂移——`client.js` 必须等于 `client-src/` 的拼接结果；片段目录里出现未登记进 ORDER 的文件也会失败，并提示跑 `npm run build:client`。
- **写操作统一入口**：新增 `postJson()`，11 处裸 `fetch` 全部收口（inventory 的 7 个写接口、控制行启停、配置保存、定价保存、数据清理、导出重置、脚手架 preview/generate、dock 状态读取）。`fetchJson` 现在会把服务端 `{error}` 文案带进异常，用户看到的是具体原因而不是 `HTTP 400`。
- 写后回读改为 `?fresh=1`，绕过 `/status` 的 800ms 缓存，避免「保存成功但面板还显示旧值」。
- **测试分工收敛**：`static.mjs` 只保留跨文件契约（manifest / exports / 版本副本 / locale / slot 注册形状），并在文件头写明「不要在这里新增源码字符串断言」；`render.mjs` 新增 4 项 dock 行为断言（真执行 `composer.dock` 组件：验证已用比例标记、余额胶囊在无账号时不占位、渲染不抛错），删掉 2 条纯实现细节断言（`viewBox: '0 0 14 14'` 与 `radius = 5.5`）。单元净增 2 项（static 99 / render 29）。

### Compatibility

- 无行为变化：拆分后 `client.js` 与拆分前**逐字节一致**（234,775 字节），面板/路由/数据格式均未改动。

## [0.27.0] - 2026-11-14

### Added

- **本会话预算的面板入口**：设置页新增「本会话预算」卡片（输入 / 保存 / 清除），对应新路由 `POST /status/session-budget`，等价于 `/embody <tokens>` 与 `/embody reset`；无活动会话时只显示说明。清除是幂等的，非法 tokens 或缺 `sessionId` 返回 400。
- **导出二次确认**：JSON / CSV 导出含本机绝对路径（cwd），改为先确认再下载。

### Changed

- **峰谷价按节假日修正**：`isPeakTime()` 增加法定节假日表（`CN_HOLIDAYS`，2026 静态清单），节假日全天不上浮；`isPeakTime(time, holidays)` 可传自定义表。
- **自定义价支持峰谷两档**：`modelPricing` 的行可带 `peak` / `offPeak` 子对象，缺省字段回落平档；`Config` schema 与 `POST /status/config` 两条校验路径都会保留峰谷，不再被拍平。

### Compatibility

- 兼容矩阵未变（`0.2.2-rc.3` 已为 `compatible`）。节假日表是静态数据，跨年需按放假通知更新。

## [0.26.1] - 2026-11-14

### Fixed

- **面板渲染失败（用户实际遇到）**：`SegmentedBar` 的阈值刻度 aria-label 直接调用了 `t()`，但该组件作用域里没有词典函数。空会话走 `MeterBar` 分支所以测不出来，**有真实用量的会话**才抛 `ReferenceError: t is not defined`，整块面板降级。现在词典文案由调用方通过 `tickLabels` 传入，组件不再依赖 `t`。
- **热更新后「侧栏有入口、主区域空白」**：挂载标记原先只存 boolean，HMR 更新 `client.js` 后新 bundle 的 `apply()` 直接返回，新组件没注册、旧注册又被清理。现在标记记录版本号，检测到旧版本时先调用旧 bundle 的 disposer 再重新注册。
- `CtxPage` 外再包一层边界：整体渲染失败时显示「本卡片渲染失败：<原因>」并带重试，而不是空白。

### Changed

- `/status` 增加 800ms 短缓存，但**绑定修订号**：测量、压缩日志、引导状态任一写入都会让缓存立即失效，避免写入后读到旧数据（`?fresh=1` 可强制绕过）。
- 折叠缓存 TTL 从 20s 提到 60s、上限 40→60 个会话；活跃会话仍按 3s 刷新。

### Added

- `test/fetch-chain.mjs`（3 项）：真正执行 `useStatus`/`fetchJson` 的异步链，抓「Response 已解析却再次 `.json()`」这类错误。
- `test/mount-guard.mjs`（7 项）：固定挂载幂等与 HMR 重挂契约。
- `test/locale-keys.mjs`（6 项）：校验 en/zh 词典键一致，且每个 `t('key')` 调用都在词典里。
- `scripts/ui-check-panel.mjs`：按指定窗口尺寸打开 web 实例、点开「上下文」并断言四 tab/内容/无异常的标准检查脚本。
- lint 启用 `no-undef`：变量未定义在 CI 直接失败。

### Compatibility

- 新增 `0.2.2-rc.3` = `compatible`（Windows Desktop 真实安装 + 重启 + 面板确认）；`0.2.2-rc.1` 仍为 `unknown`。

## [0.26.0] - 2026-11-11

### Changed

- **性能**：`/insights` 与 `/analytics` 现在共享同一份 5s 短缓存结果，Overview 打开时不再重复 `listSessions` + 折叠 + 排序；前端 `/live` 增加飞行期去重（CtxPanel 与 CtxDock 不再双拉同一会话），MutationObserver 节流从 2s 放宽到 3s；compaction-log 超限时截到低水位（256KB）而非刚好 400 行，避免在 512KB 边界反复全量读写。
- **首次引导「稍后」语义修正**：此前「稍后」按钮写入 `dismissed:true`（永久关闭），与文案矛盾；现在改为 `deferredAt`（短时不再打扰，之后仍会再出现）。新增 `POST /onboarding { reset:true }` 与设置页的「重新打开设置」入口（`onboardingReopen` 此前已定义但从未渲染）。
- **错误提示人话化**：401/403/5xx 与网络错误映射为可操作文案（附原始信息供诊断），不再只显示 `HTTP 401`。
- **数字口径统一**：`tok` 缩写统一为 `tokens`；头部上下文标注「插件预算」，与「费用（估）」口径一致。
- **可访问性**：日图/趋势图容器加 `role="img"` + `aria-label`；分段上下文条的警告/超限阈值线补 `aria-label`，消除颜色唯一信号。
- **安全加固**：`metrics.js` 工具名计数改用 `Object.create(null)`（防 `__proto__` 原型污染）；PERMISSIONS 补两条披露（scaffold MCP `command` 不做白名单、导出含本机绝对路径）。

### Compatibility

- 无变化：`0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = unknown。

## [0.25.0] - 2026-11-10

### Changed

- **预算优先级调整**：控制行的 `maxContextTokens > 0` 现在是显式覆盖，优先于宿主全局默认值；此前它只是 `budgetFor` 的 fallback，而宿主默认值恒存在，导致该配置**从不生效**。状态接口的 `budget.source` / `budget.controlTokens` 反映实际来源。
- **状态目录按 profile 隔离**：`~/.dsh/agent-embodiment/profiles/<profile>/`；识别依据是「哪个 profile 的依赖真的指向本插件目录」。识别不出来时沿用旧的共享目录，行为不变；首次进入时把共享目录的状态文件复制过去（不覆盖已有文件）。
- **鉴权失败关闭**：挂了 `webServer` 但没有 `connection` 服务时，状态路由一律 403；纯 headless（没有 webServer）仍放行。此前这种自定义组合下 23 条路由全部裸奔。
- **CSV 导出带 UTF-8 BOM**：Excel/WPS 在中文 Windows 上不再把标题、cwd 里的中文按 ANSI 解析成乱码；公式注入防护不变。
- `docs/` 与 `PERMISSIONS.md` 说清兼容声明口径：`engines.dsh` 只是安装范围，逐版本验证状态看 `dshReleases`（`unknown` 不代表被阻断）。

### Added

- `insights.js` 新增 `pricing-stale` 洞察：价格表超过 30 天未更新就提示（`PRICING_STALE_DAYS`），避免官方调价后费用估算静默偏差。
- `profile.js`（纯函数）+ `test/profile.mjs`：profile 识别、状态目录计算、旧目录迁移；11 项断言。
- `client.js`：面板卡片级 `ErrorBoundary`（单张卡片渲染失败不再让整块面板变空，带“重试”）与 tab 可访问性（`role=tablist/tab/tabpanel`、`aria-selected`、方向键 / Home / End 切换）。
- `scripts/bench-analytics.mjs`：analytics 折叠性能基线（P50/P95 与 RSS），结果记入 LIMITATIONS。
- `oxlint` 配置与 `npm run lint`；CI 增加 npm 缓存、`concurrency`、lint 与 `npm ci`。
- 状态接口新增 `profile` 与 `compatibility`（范围 + 逐版本状态）字段。

### Fixed

- **面板整块崩溃（0.24.0 起的真实缺陷）**：`CtxPanel` 里 `analyticsLimit` 引用 `budget` 早于其 `const` 声明，函数作用域的 TDZ 让每次渲染都抛 `ReferenceError`，四个 tab 一起变空；任何卡片级边界都救不了。已把 `data` / `budget` 提到使用点之前。
- 新增 `test/render.mjs`（最小 React mock 真跑面板组件）作为这类问题的回归测试；此前 static/smoke 只做源码字符串断言，全绿也发现不了。
- `test/prompt-state.mjs` 补 `MockConnection`：真实 web profile 一定有 connection，测试桩缺少它会让状态路由按 0.25.0 的新规则返回 403。
- `scripts/wsl-verify.sh` 默认改为 dry-run：只同步副本 + 跑测试；`--apply` 才执行安装、`pkill` 与启动，避免“只是想验证”却改掉 profile 指向。
- `test/static.mjs` 补 3 条工具链断言（lint 脚本、oxlint 配置、lockfile），`files` 加入 `profile.js`。

### Compatibility

- `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = unknown（Desktop 端到端仍未做）。

## [0.24.1] - 2026-11-10

### Fixed

- 状态文件改为原子写（临时文件 + rename）：`session-toggles.json`、`onboarding.json`、压缩日志截断/清空不再可能留下半截 JSON；读取失败时自动回落到最近一份备份（备份文件名在同一毫秒内去重，轮转仍保留 30 份）。
- 跨会话统计的读取超时改为 `AbortSignal` 取消：`observeSession` / `listSessions` 超时会一并中止底层读取，不再只丢弃结果而让会话观察继续运行。
- CSV 导出增加公式注入防护：以 `=`、`+`、`-`、`@`、TAB、CR 开头的文本单元格会加前导 `'`，真实数字保持数值形态；RFC 4180 引号规则不变。

### Added

- `persist.js`：原子写、写前备份、备份读取的独立模块（可单独测试），`test/persist.mjs` 覆盖原子覆盖、备份轮转与损坏回落。
- `scripts/bump-version.mjs`：一次同步 package/client/README/IMPLEMENTATION 的版本号；static 测试新增三处版本一致性断言。
- `screenshots.json`：向插件市场声明详情页截图（仓库内相对路径）。
- `scripts/wsl-verify.sh`：在 WSL 里同步源码、跑单元/集成测试并安装到指定 profile 的一键验证脚本。

### Changed

- `PERMISSIONS.md` 与实现对齐：补充 `sessionQuery.observeSession` 读取的派生字段（标题/cwd/模型/工具/用量）、数据导出字段与公式注入处理；修正 `process.env` 的表述；兼容矩阵补上 `0.2.1-rc.3`。
- 兼容矩阵补 `0.2.1-rc.5`：在 WSL `web` profile 做真实安装 + 启动 + `GET /status` 校验（`version 0.24.1`、`control.active=true`），见 [EVIDENCE E32](docs/EVIDENCE.md)。`0.2.2-rc.1` 仍为 `unknown`（Desktop 端到端未做）。
- `scripts/wsl-verify.sh` 修复首跑暴露的三处缺陷：`LOCALAPPDATA` 未绑定导致中途退出、单元套件在独立安装副本里因缺 `../../README.md` 失败（改为在仓库检出目录跑）、asar 探测改用 Windows 用户目录通配 + `DSH_ASAR` 优先；安装后打印实际链接目标与回滚命令。
- 插件 README 增加安装 / 升级 / 回滚章节（npm 发布前使用源码路径安装）。

## [0.24.0] - 2026-10-25

### Added

- 首次运行设置卡：确认插件预算、选择压缩策略、显式授权是否写入控制行；可以跳过，预算与策略之后仍可修改。
- 健康检查（控制行 / 可写入配置 / 预算已确认 / 已有测量），控制行缺失且可写时提供一键修复。
- 面板提醒条与 dock `⚠`：上下文达到警告/超限线、控制行未挂载、最近一次压缩失败；可在设置中关闭。
- 可执行洞察卡：工具定义占比、从未使用的工具、单会话反复压缩、压缩失败、未知模型价格、费用异常会话，每条可跳到对应位置。
- 压缩节省估算：按成功压缩的 `before - after` 汇总减少 tokens，并按 V4.1 Flash 输入价折算，明确标注口径。
- 会话对比（并排比较两个会话）与会话按最近活动 / tokens / 费用排序；费用最高会话高亮。
- 设置页模型价格编辑器：增删自定义 `match` 正则与 input/cacheRead/cacheWrite/output 行。
- 数据管理：按当前扫描范围导出 JSON / CSV，分别清空压缩日志、会话开关或两者；清空为两步确认。
- 提示词变更预览与增减 token 估算；工具行显示禁用后影响；保存无变化时按钮禁用。
- 新路由：`/status/insights`、`/status/onboarding`、`/status/export`、`/status/data/reset`。
- `insights.js` 纯规则引擎与 12 条单测；`metrics.js` 增加工具调用计数与 `estimateInputCost`。

### Changed

- 默认触发线从 `1` 改为 `0.9`：`balanced` preset 现在也是 0.9 触发 / 0.6 目标 / 保留 25%，不再等到窗口打满才压缩。
- `autoMountControl` 默认改为 `false`：首次运行必须由用户显式同意，插件不再静默改写 agent preset。
- 左侧导航 `embody` 重命名为 `Context` / `上下文`；Agent 从顶层 tab 移入设置 → Labs，面板固定为概览 / 趋势 / 事件 / 设置四个 tab。
- 跨会话分析显示“已扫描 / 总会话 / 上限”，不再把 `analyticsLimit` 截断后的结果当成全量。
- 概览去掉与页头/dock 重复的上下文大卡、与每日图重复的活跃度热力图，以及重复的费用 KPI；只保留 KPI 带、计费卡、每日图、最近会话。
- 页头合并为“会话 + 已用/剩余（或累计）+ 请求 + 费用”一行，并复用分段构成条；空会话不再显示四个 0% 构成。
- 会话卡从嵌套 button 改为可点击卡片 + 独立“打开会话”按钮。
- 设置页移除重复的“压缩记录”折叠块，压缩/注入历史统一到“事件”页。
- 版本升到 `0.24.0`。

### Fixed

- 会话列表不再依赖 `sessionQuery.listSessions()` / `sessions.list()` 的隐式顺序：显式按活动时间倒序后再取“最近 N 个”/latest。
- 自动挂载只写已知 preset id；找不到标准 preset 时只告警，不再猜一个任意 preset；重新启用时保留控制行原有 `mode` / `cooldownMs` / `maxAttempts` / `keepTokens`。
- 全局工具 toggle / “恢复全部”现在同步 `setGlobalDisabledTools`，重置后控制半侧不再沿用旧的全局禁用。
- 脚手架拒绝任意盘符根和 Windows `SystemRoot` / `ProgramFiles` / `ProgramData` 等系统目录。
- “恢复全部”同时清除会话提示词文本覆盖。
- 页头与会话卡的费用统一标注为“费用（估）”。
- 会话切换时清空上一会话的 `selected` 历史选择，趋势/详情不再停留在旧会话。
- `useLive` 在 path 变化时立即清空旧 payload，并用请求路径守卫丢弃迟到的旧响应；dock 同样按 sessionId 守卫。
- 补上 `sessions` 服务晚注入时的订阅；头部请求数只在 detail 属于当前会话时使用。
- 会话级提示词编辑草稿、展开态和确认态在切换会话时重置，避免把 A 会话的编辑带到 B 会话。
- “打开会话”优先调用官方 `uiWorkspace.openSession`，并补 `role=treeitem` 侧栏回退。
- 提醒条使用 `--dsw-alias-state-warn-primary`，修复无效 token 导致的不可见。

### Tests

- `static 95/95`、`metrics 35/35`、`state 18/18`、`scaffold 146/146`、`insights 12/12`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`。
- 新增静态断言：会话切换丢弃旧响应、清空历史选择、概览去重、`uiWorkspace.openSession`、会话排序、自动挂载目标、全局工具同步、Windows 路径、费用标签与“恢复全部”文案。
- `state.mjs` 覆盖 `clearSessionToggles` 同时清工具/提示词开关和会话提示词文本；`metrics.mjs` 覆盖工具调用计数与输入费用估算。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`（headless + Web 实测；Desktop 未单独验收）。

## [0.23.0] - 2026-10-24

### Added

- `compressionStrategy` preset：`conservative`（0.9 / 0.7 / 保留 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）；显式 `triggerAt` / `targetAt` / `keepTokens` 优先。
- 设置页增加压缩策略选择；切换策略会同步触发/目标比例。
- `analyticsLimit` 配置（1..200，默认 40），`?limit=` 仍可临时覆盖。
- 控制行未挂载时，工具/提示词修改会显示提示并拒绝执行。
- 计费按 DeepSeek 官方人民币峰谷价换算：V4.1 Flash / V4 Pro 的缓存命中、未命中、输出分开计价，每条请求按北京时间判定高峰/空闲。
- 概览新增计费卡；页头、会话卡、趋势卡与 tooltip 显示人民币费用。
- 静态测试新增压缩策略/control 未挂载提示/dock 已用百分比/趋势图与头部摘要/计费断言。

### Changed

- 版本升到 `0.23.0`。
- 底部 dock 改为跟随内置 ContextMeter 的读法：环形 + “插件上下文已用”百分比（分母仍是插件预算）；弹层显示已用/上限/剩余。
- 面板头部增加会话/预算/已用/剩余/请求数摘要与使用率条；趋势图补纵轴刻度、预算线、输入/输出配色和请求序号，替换原有的黑柱与 T 轮次标签。
- 费用从“只对旧模型按全天同价”改为官方峰谷价逐条估算，概览 KPI 与新增计费卡都读 `kpi.cost/costParts`；自定义 `modelPricing` 仍按全天同价。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`；`0.2.1-rc.3` 已完成 headless + Web 实测并加入矩阵，Desktop 未验收。

## [0.22.0] - 2026-10-24

### Changed

- 底部 token 指示器只显示“插件上下文”上限，不再重复官方 ContextMeter 的用量/构成。
- 脚手架定位改为 experimental 可选；`sense-environment` / `verify-change` 改为 `processSkills: true`（CLI `--process-skills`、面板 checkbox）才生成，默认只生成角色/delegation skill。
- 4 个依赖外部 MCP/知识库的模板标记为 `experimental`。
- 成本估算支持 `modelPricing` 用户价格表。
- `autoMountControl` 写入 preset 后回读校验，失败写 warning。

### Removed

- 生成的 `sense_environment` 工具与 `tool-catalog` skill。
- 底部指示器中重复的圆环/百分比/构成展示。

### Security

- 所有 HTTP 路由统一经过 `ctx.connection.requestRejection`；POST 只接受 `application/json`。
- scaffold `targetDir` 拒绝文件系统根、home 及其祖先、系统目录、`$DSH_HOME` 与常见凭据目录。

### Tests

- `static 77/77`、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 66/66`、`prompt-state 11/11`。
- Tier B 50 题四组对照与 scaffold 降本复核见仓库 `eval/deep/RESULTS.md`。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`（已实测）；`0.2.1-rc.3` 未验证。

## [0.21.0] - 2026-10-22

### Changed

- 统一命名：市场标题 `Agent Embodiment` / `智能体具身`，包名/目录 `agent-embodiment`，命令短品牌 `/embody`。
- 新增 Agent 脚手架（6 个模板）与面板 Agent tab。
- 旧命令 `/ctx`、`/ctx-compact` 保留为兼容别名；旧状态目录自动迁移。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`。
