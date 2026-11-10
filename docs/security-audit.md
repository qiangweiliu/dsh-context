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

