# agent-embodiment 安全审计（可恢复性 + 不破坏 DSH 核心）

日期：2026-10-17（主体）· 2026-11-10（0.24.1 增量）· 版本：0.21.0 审计 + 0.24.1 增量复核（2026-10-22 重命名并同步当前实现）

## 1. 写操作清单（全部有撤销路径/备份）

| # | 操作 | 写到哪 | 触发方式 | 撤销方式 | 写前备份 |
|---|---|---|---|---|---|
| 1 | 全局上下文/阈值 | profile `cordis.patch.yml` 的 `agent-embodiment` 行 | 面板保存 | 改成原值（原值可见/可恢复） | ✅ `cordis.patch.*.bak` |
| 2 | 全局提示词覆盖 | 同上 `promptOverrides` | 面板「保存到全局」 | 「恢复原文」/「恢复全部提示词」 | ✅ |
| 3 | 全局工具禁用 | 同上 `disabledTools` | 面板全局开关 | 反向开关 / 恢复全部 | ✅ |
| 4 | preset 控制行（自动挂载） | `preset-standard` 的 config 覆盖 | 启动检测缺失时自动写入；面板启用/停用 | 面板「停用自动压缩」移除；restore 脚本移除 | ✅（configEditor.edit 包装） |
| 5 | 会话级开关 / 会话提示词文本 / autoMount 标志 | `~/.dsh/agent-embodiment/session-toggles.json` | 面板会话开关、会话保存 | 反向操作 / 恢复全部 / 删文件 | ✅ `session-toggles.<timestamp>.bak` |
| 6 | `/embody <tokens>` 会话上下文（`/ctx` 为兼容别名） | 进程内存 | 命令 | `/embody reset` / 重启 | —（不落盘） |
| 7 | 压缩 | 通过官方 `ctx.compaction` seam 写会话历史（shadow/replace） | 控制半侧 idle/pre-step、`/embody-compact` | **不可逆**（压缩本身是官方语义），但只在该 seam 内进行 | 不适用 |
| 8 | Agent 脚手架生成 | 用户提交的绝对工作区：`.dsh/scaffolds/<slug>/`、`.agents/skills/<slug>-*/`、可选 `AGENTS.md` 标记 section | 面板 Agent tab / `POST .../scaffold/generate` | 删除生成目录/AGENTS section，或用 `overwrite:true` 重新生成 | ✅ 默认拒绝覆盖；写前校验路径不逃逸；MCP 只写配置不执行 |

## 2. 不破坏 DSH 核心

- **不写 DSH 包文件**：没有任何 fs 写入指向 `node_modules/@deepseek-ai/**`；代码中所有写路径只有 profile patch 与 `~/.dsh/agent-embodiment/**`。
- **只走官方 seam**：
  - 配置/preset：`ctx.configEditor.edit()`（DSH 自带校验 + 原子写 + 重挂）
  - 会话工具限制：`agent.ctx.tools.restrict()`
  - 提示词覆盖：`system-prompt/assemble` waterfall 重建 sections（不修改原对象）
  - 压缩：`ctx.compaction.compactNow/compactIfNeeded`
- **不改会话日志**：提示词/工具覆盖只影响请求装配；会话历史唯一变更来自官方压缩 seam。
- **自动挂载的代价**：会把 `preset-standard` 整段 config 变成 profile 覆盖快照（DSH 既定行为）。DSH 升级 preset 默认值后需要重新启用/同步；这是已知取舍，已写进 README。

## 3. 可恢复性实测

1. **写前自动备份**：每次 `configEditor.edit` 与 session 文件写入前，复制到
   `~/.dsh/agent-embodiment/backups/`，保留最近 30 份。
   实测一次提示词编辑后出现：`cordis.patch.2026-10-17T14-24-54-501Z.bak`（8776 bytes）。
2. **一键还原（默认只预览，需显式确认）**：`scripts/wsl-restore-all.sh [profile]`
   - 备份当前 patch/数据文件
   - `dsh plugin remove`
   - 从 patch 删除 `agent-embodiment` 配置行与嵌套的 `agent-embodiment-control` 行
   - 删除 session 数据文件
   - 实测（临时 profile）：清理后 `grep agent-embodiment cordis.patch.yml` = **0**，`package.json` 无引用。
3. **单项撤销**：面板开关可反向、提示词可「恢复原文/恢复全部」、preset 行可停用移除；均已在前序实测。
4. **更新不重置配置**：`remove+add` / 官方 `update` 前后 profile patch 与 session 文件 sha256 不变（临时 profile 实测，见 README）。

## 4. 残留风险

- **压缩不可逆**：这是 DSH 官方压缩语义，非插件额外写历史；只应在你启用控制半侧时发生。
- **preset 快照**：自动挂载会冻结 preset-standard 配置；DSH 大版本升级后可能落后于新默认。
- **数据文件共享**：`~/.dsh/agent-embodiment/` 跨 profile 共享，按 sessionId 区分；多 profile 同时使用同一 session id 不冲突，但清理脚本会清共享数据（已先备份）。
- **普通卸载不清理**：`dsh plugin remove` 只删依赖/bundles，不会删 patch 行或数据文件；要「回到安装前」请用 `wsl-restore-all.sh`。
- **无代码签名**：插件是本地 JS，进入进程即完全信任；来源应只使用你审计过的仓库。

## 5. 建议

- 升级/更新前先确认 `~/.dsh/agent-embodiment/backups/` 有最近备份；`wsl-restore-all.sh` 执行前也会先备份。
- 生产 profile 中如需自动挂载控制行，先确认 DSH preset 结构；0.24.0 起 `autoMountControl` 默认 `false`，只有用户在引导或面板显式启用才会改写 preset。

## 6. 0.24.1 增量复核（2026-11-10）

0.21.0 之后的版本新增了四个路由（`/status/insights`、`/status/onboarding`、`/status/export`、`/status/data/reset`）、跨会话统计与会话导出。本轮复核结论：

| 项 | 结论 |
| --- | --- |
| 新路由鉴权 | 全部经 `authed` → `connection.requestRejection`，与旧路由一致；POST 只接受 `application/json` 且有体积上限 |
| 会话数据读取 | `sessionQuery.observeSession` 读取整份事件日志，但只消费标题/cwd/模型/工具/用量等派生字段，不展示或上传消息正文；导出文件由浏览器本地下载 |
| 数据导出 | JSON/CSV 只含会话级字段；CSV 已中和公式注入（`=`/`+`/`-`/`@`/TAB/CR 开头加前导 `'`） |
| 状态持久化 | 0.24.1 起原子写（临时文件 + rename）；读取失败回落到最近备份；备份同毫秒去重、保留 30 份 |
| 会话读取超时 | 0.24.1 起通过 `AbortSignal` 取消底层读取，超时不再遗留会话观察 |
| 剩余风险 | 有 `webServer` 但无 `connection` 的自定义组合下路由放行（按 headless 设计）；独立安全审查仍未做，1.0 前需补 |

## 7. 0.32.0 增量复核（2026-11-15）

0.24.1 → 0.32.0 一共加了 1 条写路由、1 个配置面、1 个浏览器侧探针，并把状态目录改成尊重 `DSH_HOME`。逐项结论：

| 项 | 结论 |
| --- | --- |
| 新写路由 `POST /status/session-budget` | 经 `authed`；只接受 `application/json`；`tokens` 必须是正数或 `null`（清除），非法值 400、缺 `sessionId` 400；`null` 走幂等的 `clearSessionBudget`；只在进程内 `overrides`（上限 200）生效，不落盘、重启即失效 |
| 节假日配置 `holidays` / `holidaysIgnoreBuiltin` | 只经 `POST /config` 与 `cordis.patch.yml` 写入；校验为 `YYYY-MM-DD` 字符串数组（≤400，去重排序）+ 布尔；非法值 400 且不写盘；不产生网络请求，只是本地判定峰谷 |
| 峰谷价 `modelPricing[].peak/offPeak` | 同样是配置面；面板价格卡保存时按原样往返（0.30.0 修掉过「保存抹平峰谷价」的回归）；单价上限由 `rateBand` 校验，非法值拒绝整份补丁 |
| `window.__agentEmbodiment` 探针 | 只写本页 `window`，含 `version / panelId / slots / mountedAt / helpers`；不含会话内容、token 或路径；`helpers` 是两个纯函数（价格行往返），供 CDP 断言与测试复用。**这是新增的浏览器侧可读面**，第三方脚本同页可读，但信息等价于已渲染的版本号 |
| 状态目录尊重 `DSH_HOME` | `resolveStateRoots` 让状态与 profile 识别跟随 `DSH_HOME`；隔离实例不再读真实 home 的 `profiles`、也不往真实 home 写（0.32.0 修，见 EVIDENCE E41）。副作用：`DSH_HOME` 指向共享目录时多实例会共享状态，这与 DSH 自身语义一致 |
| 脚手架路径守卫 | 与状态根同源（`STATE_ROOTS.home/dshHome`），仍拒绝文件系统根、home 及其祖先、系统目录、`$DSH_HOME`、常见凭据目录；逐文件校验不逃逸 `targetDir`；默认拒绝覆盖 |
| 导出二次确认 | JSON/CSV 含本机绝对路径（`cwd`），面板改为确认后再触发下载，避免误点即落盘 |
| 写后回读 `?fresh=1` | 绕过 `/status` 的 800ms 缓存读最新值；只影响读取，不改变写操作语义 |
| 测试面 | 新增 `MockConfigEditor` / `MockSessionQuery` 隔离上下文，覆盖 `POST /config`、`/export`、`/data/reset`、`/onboarding`、`/extra-prompt` 等此前零覆盖的写路由（smoke 78→103） |
| 剩余风险 | ①仍无独立第三方安全审查（1.0 前必补）；②`window` 探针为新增可读面，若将来放入更敏感字段需重新评估；③`holidays` 允许 400 条，配置补丁 16KB 上限足够，但极端长数组仍会整份替换 `modelPricing` 之外的配置段——写入前仍有自动备份（30 份）兜底 |

## 8. 0.46.0 独立审计与修复（2026-11-15）

第 1–7 节是作者自审（§7 已列「仍无独立第三方安全审查，1.0 前必补」）。本节就是那次补审：**独立审计**（全新上下文、未参与实现的审计者）的结论与本轮修复，原始报告见 `agent-embodiment/docs/security-audit-independent-0.45.md`。

### 8.1 结果

审计结论是「有条件发布」：鉴权、fail-closed、体积上限、文件级路径逃逸、备份回落都经实测成立；同时发现 1 高危 + 2 中危 + 6 低危。**全部 9 条已修复并加回归断言**（`agent-embodiment/test/security.mjs`，21 项）。

| 编号 | 严重度 | 问题 | 修复 |
| --- | --- | --- | --- |
| F1 | high | MCP `env`/`headers` 的**键**未校验就进 YAML，可注入 `!!js` 表达式（bundle 安装时被 DSH 求值） | `mcpMap` 校验键名（`^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`）；`emitObject` 所有键走 `yamlKey()` 引号化兜底 |
| F2 | medium | 受保护路径是纯字符串前缀比较：`c:\windows\system32`、`C:\WINDOWS`、`\\?\C:\Windows`、`C:\PROGRA~1` 均绕过 | 归一化（去设备前缀 / Windows 转小写 / 去尾分隔符）+ 8.3 短名一律视为受保护 + 目标已存在时按 `realpath` 再判一次 |
| F3 | medium | analytics 缓存以原始 `?range=` 为键，无上限无淘汰 | `normalizeRange()` 白名单（today/7d/30d/all）+ 缓存上限 8 条 LRU |
| F4 | medium | 提示词文本无长度上限，整份状态文件每次重写并按份备份（×30 放大） | 全局与会话两处都加 32KB 单条上限（400） |
| F5 | low | 全局工具开关绕过写队列，与提示词写入并发时互相覆盖 | 统一走 `queuePromptWrite` |
| F6 | low | `atomicWriteFile` 是 temp+rename 但不 fsync | 文件与目录都 `fsyncSync`；失败仍回落到旧文件 |
| F7 | low | `?range=` 原值进 `content-disposition` 文件名 | 只用归一化后的 `rangeKey`；顺带修掉「生产环境导出文件名是 `[object Object]`」这个真实 bug（`payload.range` 被 `...summary` 覆盖成区间对象） |
| F8 | low | `name` 可含换行，能往 AGENTS.snippet.md 插标题 | `normalizeName` 去控制字符并压空白 |
| F9 | low | `configEditor.edit` 猴子补丁不还原，卸载后仍给每次 edit 多做备份 | dispose 时还原原方法并删掉标记 |

### 8.2 对第 1–7 节的更正

独立审计指出本文档有 4 处结论不成立，已确认并更正：

1. **「有 webServer 但无 connection 时路由放行」不再成立**：0.25.0 起是 403 fail-closed。`PERMISSIONS.md` 写的 403 才是对的，本文档旧表述作废。
2. **「所有写路径只有 profile patch 与 `~/.dsh/agent-embodiment/**`」不成立**：`scaffold/generate` 接受任意绝对 `targetDir`，只是黑名单过滤；F2 证明黑名单曾有绕过。
3. **「MCP 只写配置不执行」只对插件进程成立**：生成的 bundle patch 是 `!!js` 求值面（F1 的入口）。
4. **「状态持久化原子写」方向对但强度不足**：原实现无 fsync（F6）。

§7「剩余风险 ①仍无独立第三方安全审查」至此关闭。

### 8.3 方法上的收获

- 高危项不在「路由鉴权」这一层，而在**产物层**：把不可信输入写进「以后会被执行的配置文件」比直接执行更隐蔽。
- 路径守卫这类「看起来是白名单、实际是字符串比较」的代码，在大小写不敏感的文件系统上等于没防护；跨平台插件必须显式归一化。
- 独立视角的价值在于**不读作者结论**：这次审计一次就发现作者自审 7 节里没有的 4 类问题（缓存上界、文本上限、写队列绕过、文件名回显）。
- 作者自审容易停在「我设计时想到了什么」，独立审计会问「实际传进去会怎样」——F1 和 F2 都是这样被找出来的。
