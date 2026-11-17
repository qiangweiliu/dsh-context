# 验收证据（agent-embodiment）

- 仓库：<https://github.com/qiangweiliu/dsh-context>（插件目录 `agent-embodiment/`）
- 版本：`0.24.0`（本文件随 manifest 兼容性声明一起提交）
- 采集日期：2026-10-18（E1–E15）；后续条目按各自标题日期增补，最新到 E31（2026-10-25）
- 证据层级说明：`verified` = 本次固定源码上实际执行并记录结果；`partial` = 只在明确边界内验证；`unknown` = 未取得证据。**这些证据不构成独立安全审计，也不替代商城的专项审阅。**

## 环境

| 环境 | 宿主 | Node | Profile | 说明 |
| --- | --- | --- | --- | --- |
| A | Windows 桌面版 DSH `0.2.1-rc.2` | 随应用 runtime（Node 24.x） | `desktop`（Electron 独占） | 真实日常使用环境 |
| B | WSL2 Ubuntu 24.04，`dsh 0.2.0-rc.2` | `v26.10.0` | `web`（一次性测试 profile） | 安装/启动/卸载/UI 自动化验证 |

## E1. 离线契约与测试（verified）

> 下列数字是本文档采集日期（2026-10-18）的快照；当前源码的最新计数见 [IMPLEMENTATION.md](IMPLEMENTATION.md#9-测试)。

```text
node test/static.mjs   → [static] 56/56 项通过
node test/smoke.mjs    → [smoke] 48/48 项通过
node test/control.mjs  → [control] 51/51 项通过
```

覆盖：插件导出形状、Config Standard Schema 校验、package `exports` 解析、locale、bundle patch 结构、client 渲染注册、control 半侧状态机与压缩区间（含预算不足时不调用 `compactRegion` 的负例）；本次新增 manifest 契约检查（`engines.node`、`engines.dsh`、`dsh.compatibility.dshReleases`、无生命周期脚本、运行文件已分发、无 npm 运行依赖）。

## E2. 一次性 Profile 安装（verified）

```bash
dsh plugin --profile web add /home/wu/dsh-plugins/agent-embodiment
```

```text
+ agent-embodiment link:../../../dsh-plugins/agent-embodiment
ok   - bundles 含该包: true
ok   - dependencies 含该包: true
ok   - node_modules/agent-embodiment 存在（link -> /home/wu/dsh-plugins/agent-embodiment）
ok   - --dump-config 出现该行（5 处）
安装完成：agent-embodiment@0.14.19 已进入 profile web
```

## E3. 启动与 UI（verified，web profile）

启动：`dsh --profile web`（无头，等待 token 后访问 `http://127.0.0.1:3080/?token=…`）。

```json
GET /api/agent-embodiment/status
{
  "plugin": "agent-embodiment",
  "version": "0.14.19",
  "budget": { "tokens": 128000, "warnAt": 0.75, "errorAt": 0.9, "source": "default" },
  "control": { "active": true, "mode": "idle", "presetMounted": true, "lastError": null }
}
```

真实浏览器（headless Edge + CDP）打开侧栏 ctx 页：

```json
{
  "ok": true,
  "version": "v0.14.19",
  "title": "上下文监控",
  "chipTitleAttr": "插件版本: 0.14.19",
  "panelPresent": true,
  "errors": []
}
```

自动挂载生效：profile `cordis.patch.yml` 中出现 `preset-standard` 覆盖段与 `agent-embodiment-control` 行（`mode: idle`），控制半侧 `presetMounted: true`。

## E4. 卸载与残留清理（verified）

```text
dsh plugin --profile web remove agent-embodiment
ok   - dsh plugin remove 成功：- agent-embodiment link:/home/wu/dsh-plugins/agent-embodiment
cleaned: preset-standard(auto-mount)
ok   - profile patch 清理完成
ok   - package.json dependencies 不再含该包
ok   - package.json bundles 不再含该包
ok   - 移除残留 symlink（-> /home/wu/dsh-plugins/agent-embodiment）
ok   - --dump-config 不再出现该行
结论：agent-embodiment 已从 profile web 卸载，依赖/bundles/node_modules/组合树均无该插件。
```

说明：自动挂载会经官方 `configEditor` 在 profile patch 写出行，`dsh plugin remove` 不会代删；仓库提供 `scripts/clean-agent-embodiment-profile-patch.mjs`（先备份再按 id 移除）并已内置进 `scripts/wsl-uninstall.sh`。清理后 `--dump-config` 归零。

## E5. Windows 桌面真实 profile（partial）

- 安装组合已注册：`profiles/desktop/package.json` 的 `dependencies` 含 `"agent-embodiment": "link:C:/Users/40410/Desktop/context/agent-embodiment"`，`dsh.profile.bundles` 含 `agent-embodiment`；已安装副本版本 `0.14.19`。
- 桌面版不允许 CLI 管理该 profile（`profile "desktop" is managed exclusively by the Electron application`），由 Electron 启动时加载；历史运行实例已验证：status 路由 HTTP 200、`version` 与已安装副本一致、`control.active: true`、`presetMounted: true`，并真实执行过压缩（一次记录：before `215229` → after `80639`，`lastError: null`）。
- **当前运行实例是旧版本（0.14.11），0.14.19 需重启桌面版后生效**；重启后应出现「上下文监控 / v0.14.19」与 `data-embodiment-version` 标签。

## E6. 权限静态审计（partial）

在固定源码上人工核对（非商城扫描器结论）：

```text
process.env 引用：0
child_process / execSync / spawn：0
outbound fetch（宿主）：0；client.js 的 fetch 全部是同源相对路径
文件写入：~/.dsh/agent-embodiment/session-toggles.json、backups/、经 configEditor 写 profile patch
文件读取：插件状态文件；宿主 @deepseek-ai/*/lib/*.js（只读索引，≤700 文件 / 2 MiB）
npm 运行依赖：无；生命周期脚本：无
外部服务/遥测/CDN：无
```

完整权限矩阵与失败边界见 [PERMISSIONS.md](PERMISSIONS.md)。

## E7. UI 优化验证（partial，2026-10-18）

- 版本：`0.14.19`（WSL profile web 安装后由 headless Edge + CDP 截图验证）。
- 修复：概览卡/工具卡不再被纵向 `flex-basis` 撑到 ~320px 高；空态/加载态改为高度自适应；阈值颜色变量改为真实存在的 `--dsw-alias-state-warn-primary`。
- 概览卡改为环形图 + 已用/上限/剩余 KPI + 8px 分段条 + 右对齐图例；顶部状态 badge（正常/警告/超限）。
- 工具与提示词：≤6 项自动展开、>6 项默认折叠；「仅看已启用」筛选；加载 skeleton / 空态虚线框 / 错误重试。
- Dock 弹层底部新增「打开完整面板」，点击跳到侧栏 ctx 页（弹层内已验证按钮存在并可点）。
- P2：卡片头折叠按钮 + `localStorage` 记忆，刷新后 `data-embodiment-collapsed="1"`、`stored={"inventory":true}`（CDP 实测）；`prefers-reduced-motion: reduce` 模拟下注入的 `<style>` 生效，环形图 `transition-duration` 变为 `1e-05s`；KPI/图例/环形图均带精确 token `title`；新增「较上次同步」增量 KPI（同会话两次刷新的差值）。
- 截图：`docs/ui/current-panel-session.png`（1400px 暗色，6% 真实用量）、`docs/ui/current-panel-empty.png`、`docs/ui/current-panel-light.png`（浅色主题：移除 body `data-ds-dark-theme` 与内联 `--dsw-*` 后截图）、`docs/ui/current-panel-900.png`、`docs/ui/current-panel-600.png`（600px 窄屏：hero 自动换行、卡片单列）、`docs/ui/current-panel-collapsed.png`、`docs/ui/current-dock-popover.png`。
- 未覆盖：Firefox/Safari（本机未安装 Firefox，WebKit 不可用）；浅色主题用「切换 `data-ds-theme-source` + 移除 body 暗色 token」模拟，未走 app 设置里的主题偏好切换；桌面运行实例需重启后才加载 `0.14.19`（当前仍是 0.14.11）。

## E8. 压缩记录（成功 / 失败日志）验证（partial，2026-10-18）

- 版本：`0.14.19`。
- 事件源：`control.js` 在 `enforce`（manual/idle）、`compactIfNeeded` / `compactRegion`（idle/step）的成功与失败分支调用 `recordCompactionEvent`；失败同时保留 `lastError`。`state.js` 内存最多 200 条，`index.js` 订阅后追加 JSONL。
- 测试：`control 42/42`（新增 success-idle 日志、failure-含原因、manual-success 3 条断言）；`smoke 46/46`（新增 status.control.log 数组、临时 HOME 下 JSONL 落盘、status 返回刚写入记录 3 条断言）；`static 49/49`（state 导出接口 + client 可折叠容器）。
- 持久化：`~/.dsh/agent-embodiment/compaction-log.jsonl`；宿主 apply 时 hydrate，`subscribeCompactionLog` 追加；超过 512KB 只保留最近 400 行。
- UI：控制卡底部「压缩记录 N」默认折叠；展开后每条记录独占一个块（结果 badge、时间、before→after、轮次、trigger、session 短 id），失败原因另起一行、长文案自动换行，不会把多条记录挤在同一行。
- 截图：`docs/ui/current-compaction-log.png`（暗色）、`docs/ui/current-compaction-log-light.png`（浅色）；用 3 条种子记录验证「重启后从 JSONL hydrate」的渲染。
- 未覆盖：真实压缩事件的写盘只在测试 harness（临时 HOME）中验证；WSL 运行实例当前未触发真实压缩，故 UI 截图里的 3 条为种子数据。

## E9. 阈值驱动 UI + triggerAt 触发 + 清理（partial，2026-10-18）

- 版本：`0.14.19`。
- A（阈值驱动显示）：`/api/agent-embodiment/status` 与 `/live` 返回 `warnAt/errorAt/triggerAt`；`client.js` 的 `ratioColor/ratioState` 接收阈值，概览卡、Dock、`SegmentedBar` 全部按配置阈值取色/取状态；配置卡新增「触发比例」输入，概览 chips 同时显示警告/超限/触发三个阈值。
- B（阈值参与触发）：宿主 Config 新增 `triggerAt`（默认 1，取值 (0,1]）；`state.js` 提供 `setDefaultTriggerAt/getDefaultTriggerAt`；`control.js` 的自动压缩（idle/pre-step）触发条件改为 `used > budget × triggerAt`；`/embody-compact` 手动压缩不受 triggerAt 限制。
- C（清理）：修正 `control.js` 头注释与 README 模式表（idle 实际监听 `agent/pre-step` 并带 `compactRegion` 兜底）；删除 notify 分支不可达的 `retryEnforce`；明确 `maxAttempts` 只作用于 `/embody-compact`；预压缩失败文案区分“阈值触发但没有可安全压缩历史”。
- 测试：`static 51/51`（新增 triggerAt 校验）、`smoke 46/46`、`control 45/45`（新增 triggerAt 0.5 触发 / triggerAt 1 不触发两组断言）。
- 实测（WSL 临时配置 `tokens 10000 / warnAt 0.5 / errorAt 0.6 / triggerAt 0.5`）：
  - 用量 74% 时状态 badge 为「已超限」、环形图红色（旧硬编码 75% 会显示「正常」），chips 显示 `50% / 60% / 50%` → A 生效；截图 `docs/ui/current-thresholds-config.png`。
  - 第二个 turn 的 `pre-step` 在 7.4K > 5K 时触发 idle 压缩并写入 failure 日志（`7,380 → 7,380`，没有可安全压缩历史）→ B 生效；截图 `docs/ui/current-trigger-prefire.png`。
  - 测完已通过配置接口恢复默认 `128000 / 0.75 / 0.9 / 1`，并清理测试压缩日志、停止测试 server。
- 未覆盖：仅 WSL web profile 实测；桌面版需重启后生效，真实桌面 profile 未做阈值实测。

## E10. 压缩平滑化（targetAt 闭环 / 预检跳过 / 压缩中状态，2026-10-18）

- 版本：`0.14.19`。
- `targetAt`：新增宿主 Config `targetAt`（默认 `0.6`，要求 `0 < targetAt < triggerAt`）；`state.js` 提供 `setDefaultTargetAt/getDefaultTargetAt`。
- 闭环：`idle` 模式先让引擎 `compactIfNeeded` 压一次；没到目标线时循环 `compactRegion`（每轮重新算“最小可压前缀”），最多 `maxAttempts` 轮，或直到没有进展；`/embody-compact` 同样以目标线为停止条件。
- 预检：`triggerAt < 1` 且没有足够可压历史时静默跳过，不调用压缩服务、不写 failure、不置 `lastError`（实测 74% 预压缩场景压缩记录仍为 0，控制卡保持「正常」）。
- 状态提示：`state.control.compacting` 经 status 快照和 `/live` 暴露；控制卡在压缩中显示「压缩中…」badge + 提示，Dock 标签显示「ctx 压缩中…」。
- 测试：`static 56/56`（新增 targetAt 默认/范围/与 triggerAt 关系、keepTokens 校验）、`smoke 48/48`（status 含 triggerAt/targetAt/keepTokens）、`control 51/51`（新增 targetAt 闭环、无历史预检静默跳过、宿主 keepTokens、压缩中状态复位）。
- 实测（WSL 临时配置 `tokens 10000 / triggerAt 0.5 / targetAt 0.3`）：74% 用量 + 无可压历史时压缩记录保持 0、无红色 lastError（`docs/ui/current-precheck-skip.png`）；目标比例字段与四个阈值 chip 显示正确（`docs/ui/current-target-at.png`）。
- 未覆盖：未在真实长会话中测量压缩延迟与目标闭环的实际收敛轮数（仅 mock 控制测试）；桌面版需重启后生效。

## E11. WSL 长会话实测：压缩延迟与目标闭环收敛轮数（2026-10-18）

- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，web profile，模型 `agnes-3.0-flash`，插件 `0.14.19`（测试时用临时计时补丁，未提交）。
- 造长会话：新会话连续 6 轮“写约 800 字中文文章”，用量长到 **14,773 tokens**（系统提示+工具定义约 7.4k，历史约 7k）。
- 配置：`contextWindowTokens 14,343`、`triggerAt 1`（触发线 14,343）、`targetAt 0.95`（目标线 **13,626**）、`keepTokens 300`；`mode: idle`。
- 一次自动压缩实测：
  - 触发点：下一轮 `agent/pre-step` 测得 14,773 > 14,343；
  - 轮数：**rounds=2**（引擎 `compactIfNeeded` 1 次 + 范围 `compactRegion` 1 次）；
  - 耗时：**43,522 ms**（从 `agent/pre-step` 开始压缩到压缩完成写日志）；
  - 结果：before **14,773** → after **13,044**，已低于目标 13,626 → **收敛**；`lastError=null`；
  - UI：采样点 +22s、+44s 时 `compacting=true`，下一轮采样变回 `false`；聊天记录出现「上下文已压缩 · 已压缩 5 条历史记录（约 2559 tokens）」（`docs/ui/current-compaction-latency.png`）。
- 对照（同一会话族，目标 60%）：`budget 11,948 / target 7,168 / trigger 10,155` 时压缩一次（rounds=2，6,483 ms），after 9,410 仍高于目标；原因是 **系统提示+工具定义的基础开销约 7.4k，目标 7,168 低于基础开销，物理上不可达**，不是闭环无效。默认 128k 预算下 60% = 76.8k，不存在这个问题。
- 实测中暴露并修复的两个问题：
  1. `keepTokens` 之前只存在于宿主 Config，没有传给控制半侧；预设行被配置保存重写后自定义 `keepTokens` 也会丢。已改为宿主 `keepTokens` 经 `state.js` 下发给控制半侧（`0` 仍表示预算 25%）。
  2. 选前缀下限原为 `1000 tokens`，当目标只差 814 tokens 时 `planRegion` 返回 null，导致“目标已可达但不压”。已把下限降为 `max(200, min(keepFloor, needed))`，本次实测才得以触发。
- 局限：只测到 1 次成功收敛（n=1），43.5s 是模型摘要耗时，会随历史大小/模型负载波动；该耗时发生在 `agent/pre-step` 内，**会阻塞当轮请求**（截图里本轮对话确实等了压缩完成后才出现回复）。长会话真实 128k 预算下的目标 60% 尚未在 WSL 造出同等规模会话复测。

## E12. v0.15.0 整页 tabs + 跨会话洞察（2026-10-18）

- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，web profile，模型 `agnes-3.0-flash`，插件 `0.15.0`；headless Edge + CDP 截图。
- 数据源：`GET /api/agent-embodiment/status/analytics?range=7d&limit=40` 与 `/status/session-detail?sessionId=...`；宿主通过 `ctx.sessionQuery.listSessions()` 取最近 40 个会话，再用 `observeSession(id, { projectionMode:'none' })` 读事件，按 `metrics.js` 纯函数折叠。
- 概览（`docs/ui/0.15-overview.png`）：KPI 带显示最近 7 天 40 个已扫描会话（总库 102）的会话数 / 1.3M tokens / 84.3% 缓存命中 / 工具调用 / 17m 活跃时长 / 6 次压缩；费用显示 `—`，因为当前 `agnes-3.0-flash` 没有可识别价格，UI 明示「该模型暂无价格」，不伪造数字。下方是每日 tokens、活跃度热力、四色上下文卡和可搜索/排序/展开的最近会话。
- 趋势（`docs/ui/0.15-trend.png`）：选中一个 8 请求的历史会话，逐请求 prompt/output 柱状图 + 压缩标记；压缩记录显示 2,559 tokens / 43.5s，与 E11 的实测压缩一致。
- 事件（`docs/ui/0.15-events.png`）：成功/失败筛选；实测一条手动压缩失败记录（`manual compaction could not produce a smaller summary`），能显示 target、轮次/耗时、原因；下方时间线只列压缩事件，注入数量在标题上汇总。
- 设置（`docs/ui/0.15-settings.png`）：控制卡、全局配置、工具与提示词集中到设置 tab；保存仍走 `configEditor`。
- 测试：`test/metrics.mjs` 17/17（usage/cache/成本/压缩耗时/范围过滤），`test/static.mjs` 56/56，`test/smoke.mjs` 48/48，`test/control.mjs` 51/51。
- 局限（诚实声明）：
  - 跨会话 KPI 只扫描最近 40 个会话（界面标 40/102），不是全库；全量扫描会随会话数增长而变慢，因此没做；
  - 费用只对内置价格表的 DeepSeek 模型估算，未知 provider 显示 `—`；
  - 会话卡点击是「在本页看趋势」；另有「打开会话」链接按标题点击左侧会话列表（DOM 桥接）。没有公开的客户端切会话 API，找不到标题时静默不跳。
  - 趋势图未画目标线，只显示预算文字；活动热力最多 90 天（`all` 时）。
  - 首次加载 40 个会话的事件折叠耗时未做独立压测；已加 20s 内存缓存和 4 并发限制。

## E13. v0.16.0 新增提示词 section（2026-10-18）

- 环境：WSL Ubuntu 24.04，web profile 的临时副本（验证后删除），模型 `DeepSeek-V41-Flash`，插件 `0.16.0` 本地 `link:`。
- 后端：`POST /api/agent-embodiment/status/inventory/extra-prompt` 写入 `extraPrompts.project-rules`，返回 202；下一次装配的 inventory 出现：
  - `agent-embodiment:extra:project-rules`，`extra:true`，`extraName:"project-rules"`，约 29 tokens。
- 会话日志（`session-2ce1e5b8-...`）：system prompt 文本为 `harness:identity` → 新增 section → `deployment:persona-prefix`，**原 identity 保留，未覆盖**；连续 2 轮都回复验证码 `EXTRA-ONE`，且只有 1 条 `system/message`（内容未变时不重复写）。
- UI：headless Edge + CDP 在「工具与提示词 → 提示词 → 新增提示词」填入 `ui-rules` / `UI-ONE`，保存后 `GET /inventory` 的 `extraPrompts` 出现该键；删除接口返回 202 并清空。
- 测试：`test/static.mjs` 58/58，`test/smoke.mjs` 48/48。
- 局限：验证使用临时 profile 副本，未在 Desktop Electron profile 内实测；新增提示词只对之后的请求生效，已有会话的旧 system 历史不会被删除。

## E14. v0.17.0 提示词追加到每次用户提问末尾（2026-10-18）

- 环境：WSL Ubuntu 24.04，临时 web profile 副本，模型 `DeepSeek-V41-Flash`，插件 `0.17.0` 本地 `link:`。
- API：`POST /status/inventory/extra-prompt` 带 `placement: "user"`，返回 `202` 和 `placements: { "tail-rule": "user" }`。
- 会话 `session-4d79e49e-...` 连续 3 轮发送同一问题，日志检查：
  - `system/message` 1 条，且不含 `TAIL-ONE`；
  - `user/message` 3 条，**每一条**末尾都含追加文本 `TAIL-ONE`；
  - 第 1 轮模型输出 `TAIL-ONE`；后 2 轮模型因把追加文本识别为嵌入指令而拒绝复述，但追加机制本身每轮都执行。
- UI：headless Edge + CDP 在新增提示词表单使用默认位置「每次用户提问末尾」，保存后 `GET /inventory` 返回 `extraPromptPlacements: { "ui-rules": "user" }`。
- 测试：`test/static.mjs` 60/60，`test/control.mjs` 51/51，`test/smoke.mjs` 48/48。
- 局限：追加内容会写入 `user/message` 并在 UI 中可见，不是隐藏指令；模型是否服从仍是模型行为，不是插件能保证的。验证使用临时 profile 副本，未在 Desktop Electron profile 内实测。

## E15. v0.19.0 修复验证（2026-10-21）

- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，隔离 `DSH_HOME=/tmp/dsh-verify`，从 `web` 模板创建 `ctxverify` profile，插件以 `link:` 安装；浏览器验证用 Linux Chromium + CDP。
- 单元测试：`static 72/72`、`metrics 23/23`、`state 16/16`；集成测试：`control 54/54`、`smoke 48/48`、`prompt-state 11/11`。
- 宿主实机：`GET /api/agent-embodiment/status` 返回 `version:"0.19.0"`，`control.active:true`、`mode:"idle"`（自动挂载成功）。
- 命令：在真实 Web UI 中发送 `/ctx` 后 `/status` 出现该会话的 measurement；`/ctx 200000` 后 `sessionBudgets` 为 `[{tokens:200000}]`；`/ctx reset` 后为空且 `/live` 的 `budget` 回到 `128000`。命令候选面板同时出现 `ctx` 与 `embody-compact`。
- 持久化：经 API 写入会话提示词文本 `VERIFY-TEXT` 和工具开关后，`~/.dsh/agent-embodiment/session-toggles.json` 立即出现对应键；**重启 DSH** 后再切换另一个工具，`promptText` 仍保留（证明 `hydrate → snapshot` 往返生效）。
- 全局开关：连续两次 POST 全局禁用 `bash`、`read`，profile patch 最终同时包含两项，`/inventory` 返回 `["bash","read"]`。
- UI：设置 → Context length 面板渲染 `v0.19.0`、Context limit / Trigger at / Target at / Target 等控件；控制台 `0` error、`0` exception。
- 局限：验证实例使用隔离 profile，未使用真实用户 profile；反向代理前缀场景由代码路径和静态断言覆盖，未在本机搭反代实测。

## E16. v0.19.1 安装热加载验证（2026-10-21）

- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，隔离 `DSH_HOME` + 从 `web` 模板创建的 `firstinstall` profile；Linux Chromium + CDP。
- 场景：先启动空的 Web 实例并打开页面，确认导航里没有 `ctx`；保持页面打开，执行 `dsh plugin --profile firstinstall add <本仓库/agent-embodiment>`。
- 结果：
  - 安装后 t+2s 导航仍无 `ctx`，t+4s 出现 `ctx`，页面未刷新、DSH 未重启；
  - 控制台 0 error、0 exception；
  - 运行中 `dsh plugin remove` 后导航立即消失，重新 add 后再次出现；
  - 新进程加载 `0.19.1`：`GET /status` 返回 `version:"0.19.1"`、`control.active:true`、`mode:"idle"`；
  - `scripts/wait-for-agent-embodiment.mjs <url> 10` 返回 `hot-loaded: agent-embodiment@0.19.1`。
- 版本不一致提示：临时把客户端 `CLIENT_VERSION` 设为 `0.19.0`、宿主保持 `0.19.1`，真实页面出现 `data-embodiment-version-mismatch` 与 “Reload page” 按钮；改回 `0.19.1` 后提示消失，控制台 0 error。
- 结论：首次安装、启用/停用由 DSH HMR 热生效，**不需要重启 DSH**；`LIMITATIONS.md` 中“必须完整重启”的旧描述已更正。
- 边界：**替换已安装包（升级版本）**仍是 DSH 的例外，官方要求重启进程。Desktop 0.2.1-rc.2 已单独复测，见 E17。

## E17. Desktop 0.2.1-rc.2 安装热加载验证（2026-10-22）

- 环境：Windows Desktop `DeepSeek Harness 0.2.1-rc.2`（实际运行 `app.asar` 版本），独立 `DSH_HOME=C:\Temp\dsh-desktop-verify2` + 独立 `--user-data-dir` 启动第二个实例；CDP 端口 9223。用户正在运行的 Desktop 实例未被关闭或修改。
- 场景：实例进入默认工作区后，导航中没有 `ctx`；保持实例运行，执行
  `dsh plugin --profile desktop add C:\Temp\agent-embodiment`。
- 结果：
  - 安装后无需重启/刷新，侧栏出现 `ctx`；点击后上下文监控面板渲染 `v0.19.1`；
  - `fetch('/api/agent-embodiment/status')` 经 `dsh-app://` 自定义协议返回 200，`version:"0.19.1"`；
  - 控制台 0 error / 0 exception；
  - 运行中 `dsh plugin remove` 后导航与面板消失；重新 add 后再次出现；
  - `__DSH_TRANSPORT__` 只有 `{ ownsHost, streamBaseUrl }`、没有 `fetch`，说明 Desktop 端走的是 `EventSource('/plugins/events')` 路径；`dsh-app` 注册了 streaming/fetch schemes，实际可工作。
- 结论：Desktop 0.2.1-rc.2 的首次安装、启用/停用同样由 HMR 热生效，**不需要重启 DSH**。此前“Desktop 可能仍需重启”的保留意见已排除。
- 边界：**替换已安装包（升级版本）**仍是 DSH 的例外；验证实例使用隔离 `DSH_HOME`/`user-data-dir`，未触碰真实桌面 profile。

## E18. v0.20.0 Agent Embodiment Scaffold 验证（2026-10-22）

- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，隔离 `DSH_HOME=/tmp/dsh-scaffold-live`；Linux Chromium + CDP。
- 生成：`node scripts/agent-scaffold.mjs --template repo-coder --out /tmp/embodiment-live --slug demo-coder`，首轮生成 16 个文件（bundle、patch、SENSES/HANDS/LOOP、3 个 SKILL.md、evals）；最终生成器还包含 `senses.js`、`tool-catalog`、delegation skill、eval runner 等。
- 安装：先装本插件，再 `dsh plugin --profile scaffoldlive add /tmp/embodiment-live/.dsh/scaffolds/demo-coder`；`--dump-config` 出现 `preset-demo-coder` 行。
- Preset 激活：Settings → Agent presets 的 CUSTOM 组出现 `Demo Coder`，无 Failed to load，控制台 0 error。
  - 首次激活失败：generated preset 重复挂载了全局已有的 `dsh-subagent` service 与 `spawn` provider（`service "subagents" has been registered`）。修正为 preset 只挂 `dsh-tool-subagent` 后重新生成并复测通过；这条是本次 live 验证发现并修掉的真实问题。
- HTTP 路由（真实宿主，首轮）：`/scaffold/templates` 返回 3 个模板（最终扩展到 6 个）；`/scaffold/preview` 返回 16 个文件；`/scaffold/generate` 写入目标目录；重复生成返回 409，`overwrite:true` 可覆盖。
- UI：面板 Agent tab 加载模板；首轮 3 个模板，最终 6 个（Desktop Agent tab 实测 6 个）；选择 repo-coder、填写 targetDir 后 Preview/Generate 均成功，文件落盘，0 error / 0 exception。
- 生成 host tool：`senses.js` 在 preset 内注册 `sense_environment`。在隔离实例中创建 session 后，`GET /status/inventory` 返回 17 个工具，包含 `sense_environment`；会话日志出现生成的 `sense-demo-sense-environment`、`sense-demo-verify-change`、`sense-demo-repo-coder` 三个 skill（skill catalog 生效）。
- 模板扩展到 6 个：`repo-coder`、`web-researcher`、`ops-runbook`、`browser-operator`、`data-analyst`、`support-router`。
- 生成器新增：可选 MCP rows（stdio/streamable-http，`${ENV_VAR}` 转 `!!js process.env.*`）、`AGENTS.md` 带 marker 幂等合并、`evals/run.mjs`（调 `dsh headless` 记录 transcript）。
- Desktop 0.2.1-rc.2（独立 `DSH_HOME` + user-data-dir，未触碰真实 profile）：生成 preset 最初激活失败，0.2.1 已移除 `dsh-tool-subagent` 的 `persona` 和 `toolFilter`；改为只保留跨版本字段、角色说明改用生成的 `delegate-<role>` skill 后，Agent 预设的 CUSTOM 组出现 `Desktop Demo` 且无“加载失败”；Agent 脚手架 tab 显示 6 个模板。
- 边界：MCP 本轮未连接真实 server（只验证配置生成/校验）；eval runner 不自动判分；preset 默认选择仍需用户在 Settings 里手动完成；Desktop 上 subagent 的角色/工具隔离需要单独的 Agent Preset（0.2.1 不再接受 per-tool persona/toolFilter）。

## E19. v0.21.0 统一命名与市场信息验证（2026-10-22）

- 命名定稿：市场标题 `Agent Embodiment` / `智能体具身`；npm 包名与仓库目录 `agent-embodiment`；命令短品牌 `/embody`；旧名 `ctx-mon-and-con` 仅保留为历史记录和兼容别名。
- 环境：WSL Ubuntu 24.04，`dsh 0.2.0-rc.2`，隔离 `DSH_HOME=/tmp/dsh-rename-verify`，从 `web` 模板创建 `renameverify` profile，插件以 `link:` 安装，端口 3081；Linux Chromium + CDP。
- 包信息：`npm pack --dry-run` 输出 `name: agent-embodiment`、`version: 0.21.0`、17 个文件；`locale/en.json` 的 `meta.title` 为 `Agent Embodiment`，`locale/zh.json` 为 `智能体具身`；市场申请文件 `submission/qiangweiliu__dsh-context--agent-embodiment.yml` 的 URL/name 均指向子目录。
- 宿主实机：`GET /api/agent-embodiment/status` 返回 `plugin:"agent-embodiment"`、`version:"0.21.0"`、`control.active:true`、`presetRow:"agent-embodiment/control"`；旧路由 `/api/ctx-mon-and-con/status` 返回 401（未注册）。
- 状态迁移：首次启动把 `~/.dsh/ctx-mon-and-con/{session-toggles.json,compaction-log.jsonl}` 复制到 `~/.dsh/agent-embodiment/`，旧目录保留不动；控制行与提示词 section 的旧 id 在读取时映射到新 id。
- 命令：`/embody` 为规范命令，`/ctx` 仍注册为兼容别名；`/embody-compact` 与 `/ctx-compact` 同理；`test/smoke.mjs` 断言两者均可注册并在卸载时注销。
- UI（英文）：侧栏导航显示 `embody`；设置分区显示 `Agent Embodiment`；面板显示 `v0.21.0`、`/embody` 提示与 `Agent` tab；控制台 0 error / 0 exception。
- UI（中文）：在设置里切换语言到中文后，设置分区显示 `智能体具身`，面板标题与描述为中文，`Agent` tab 显示 6 个模板（repo-coder / web-researcher / ops-runbook / browser-operator / data-analyst / support-router）。
- 测试：`static 77/77`、`metrics 23/23`、`state 16/16`、`scaffold 151/151`、`control 54/54`、`smoke 63/63`、`prompt-state 11/11`。
- 边界：市场收录仍取决于 `awesome-dsh-plugin` 的 PR 审核；本次只验证市场元数据与本地实机显示，旧路由不做兼容别名。

## E20. 0.21.0 后续加固（2026-10-23，源码审查驱动）

- 路由鉴权：18 个 `/api/agent-embodiment/status` 路由统一经过 `ctx.connection.requestRejection`（Host/Origin + 浏览器/API 认证）；测试用 MockConnection 断言拒绝时返回 401。
- POST 只接受 `application/json`，其他 content-type 返回 415，避免跨站 `text/plain` 简单请求触发写操作。
- scaffold `targetDir` 拒绝文件系统根目录、home 及其祖先、`/etc` 等系统目录、`$DSH_HOME` 与常见凭据目录。
- 底部指示器只显示“插件上下文”上限，不再重复官方 ContextMeter 的用量百分比与构成。
- 脚手架不再生成 `sense_environment` 工具与 `tool-catalog` skill；`sense-environment` / `verify-change` 改用 DSH 原生 `bash`/`read`/`grep`。
- `ops-runbook`、`browser-operator`、`data-analyst`、`support-router` 标记为 `experimental`，模板列表接口返回 `experimental` 字段。
- 成本估算支持 `config.modelPricing` 用户价格表（排在内置表之前，可补充/覆盖模型）。
- 测试：`npm test`、`test/control.mjs`、`test/smoke.mjs`、`test/prompt-state.mjs` 全部通过。

## E21. v0.22.0 定位调整与脚手架降本（2026-10-24）

- Tier B 四组对照（base / plugin / scaffold / compact，50 题）见仓库 [`eval/deep/RESULTS.md`](../../eval/deep/RESULTS.md)：
  - base 47/50；3 道长上下文题稳定失败，四组都失败；
  - compact 单次全量曾显示 input −28%，但全量 3 reps 未复现（−363，CI 跨 0；McNemar p=0.200）；
  - scaffold 工具调用 5.5 → 15.2、output +30%、耗时 +10%，补跑后准确率无提升；
  - plugin 仅宿主半侧，补跑后无准确率差异。
- 脚手架定位改为 **experimental 可选**：`sense-environment` / `verify-change` 改为 `processSkills: true`（CLI `--process-skills`、面板 checkbox）才生成，默认只生成角色/delegation skill。
- 10 道多轮题复核：旧 scaffold（含 process skills）工具调用 46.5、output 9,994、7/10；0.22.0 默认（仅角色 skill）工具调用 4.7、output 2,597、10/10；base 0.9、1,572、10/10。process skills 是主要成本来源，保留为 opt-in。
- `autoMountControl` 写入后回读 `presetMountState`，失败写 warning，避免静默失效。
- 版本升到 `0.22.0`；`client.js` 的 `CLIENT_VERSION` 同步。
- 测试：`static 77/77`、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 66/66`、`prompt-state 11/11`。
- 边界：Tier B 仅 1 次完整运行 + 差异题第 2 次；准确率差异需 3 reps 才能下正式结论。

## E22. 0.22.0 发布门禁、市场条目与 DSH rc.3 初测（2026-10-24）

- 发布门禁：`npm test`（static 77 / metrics 24 / state 16 / scaffold 146）、`npm run test:integration`（control 54 / smoke 66 / prompt-state 11）、`npm pack --dry-run`（18 个文件）全部通过。
- 市场根因：`agent-embodiment` 不在 `awesome-dsh-plugin` 的 `data/plugins/`，npm 上也没有发布；旧条目仍指向已删除的 `ctx-mon-and-con` 路径。
- 市场条目：已把 `qiangweiliu__dsh-context--ctx-mon-and-con.yml` 更新/重命名为 `qiangweiliu__dsh-context--agent-embodiment.yml`，并创建 [PR #9029](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9029)；CI（Submission gate + check）全绿、mergeable。catalog 需等维护者合并后更新。
- DSH `0.2.1-rc.3` 初测：临时 npm 安装 `0.2.1-rc.3`；隔离 profile 需要显式 `OPENCODE_GO_API_KEY`（rc.3 不再从凭据文件自动解析）；`--dump-config` 出现 `agent-embodiment`；headless 子集（memory-01 / long-01 / long-05 / code-json-patch）可运行，无启动/兼容崩溃；用 rc.3 自带的 Cordis 4.0.5 跑 smoke 66/66、control 54/54、prompt-state 11/11。Web 侧已进一步验证：隔离 web profile 启动成功，`GET /api/agent-embodiment/status` 返回 v0.23.0、`control.active:true`、`presetMounted:true`，UI 侧栏出现 `embody`、0 console error；`dshReleases` 已加入 `0.2.1-rc.3`。Desktop（Electron）仍未验收。
- 3 reps 子集：base 19/24（79.2%，avg input 23,715）、compact 20/24（83.3%，avg input 20,525）；`long-05` 在两组都是 0/3，确认系统性长表错误。

## E23. v0.23.0 压缩策略与控制 UX（2026-10-24）

- 新增 `compressionStrategy` 三档 preset：conservative（0.9 / 0.7 / keep 35%）、balanced（1 / 0.6 / 25%）、aggressive（0.75 / 0.5 / 10%）；显式 `triggerAt` / `targetAt` / `keepTokens` 优先。
- 设置页增加压缩策略下拉；切换时同步触发/目标比例。宿主 `POST /config` 支持 `compressionStrategy`，并在未显式给 trigger/target/keep 时按 preset 推导。
- `analyticsLimit` 配置（1..200，默认 40）；`?limit=` 仍可临时覆盖。
- 控制行未挂载（`control.active === false`）时，工具/提示词修改显示 `controlRequired` 提示并拒绝执行；`presetMounted` 状态继续由状态接口暴露。
- 测试：`static 79/79`（新增策略选择/control 未挂载提示断言）、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 71/71`（新增三档 preset、显式覆盖、非法策略断言）、`prompt-state 11/11`。
- 默认 scaffold 全量 50 题复核：默认（仅角色 skill）46/50、tools 5.1、output 3,836、input 18,817、72s；旧（含 process skills）42/50、tools 15.2、output 5,617、87.4s；base 47/50、tools 5.5、43:32、22,317、79s。默认 scaffold 成本接近 base，仍无准确率收益。
- 边界：策略选择只在真实 Web/Desktop 面板中做静态/单元验证，尚未做 CDP 截图。

## E24. Tier B 全量 3 reps 对照（2026-10-24）

- base：121/150（80.7%），avg 73.6s，input 21,133，output 3,933，tools 6.0。
- compact：129/150（86.0%），avg 70.7s，input 20,770，output 4,199，tools 5.4。
- 逐次配对：both pass 110、both fail 10、base 赢 11、compact 赢 19；McNemar 精确检验 p=0.200。
- input 差值 −363 tokens/次（95% CI −2,941～+2,227）；output +266（CI −293～+807）；耗时 −2.9s（CI −10.4～+4.5）。
- `long-05` 两组都是 0/3，系统性长表错误。
- rc.3：headless + Cordis 测试 + Web 状态/UI 已通过；Desktop 未验收。`engines.dsh` 与 `dshReleases` 已加入 `0.2.1-rc.3`。
- 结论：compact 的准确率/ token /耗时差异均不显著；单次全量的 −28% 不能作为卖点。Tier B 题库继续作为固定回归基线。

## E25. v0.23.0 底部 dock 改为“已用”读法（2026-10-24）

- 内置 ContextMeter 的读法是环形 + 百分比（`context.aria` = “上下文已用 {percent}”）。本插件 dock 原先只显示 `插件上下文 256K`，现改为同规格的 14px 环形 + `插件上下文 73%`；分母是插件预算（含会话级覆盖），不是模型窗口。
- 弹层对齐内置面板：标题 / 百分比 / `已用 / 上限`，明细行显示实测用量、预算上限、剩余、控制状态。
- 实测：Desktop 0.2.1-rc.2 运行中替换 `client.js` 后 HMR 生效；同一时刻内置指示器 19%（模型窗口口径）与插件 73%（256K 预算口径）并存，符合预期。截图：[dock 触发条](ui/0.23-dock-context.png)、[展开面板](ui/0.23-dock-panel.png)。
- 测试：`static 81/81`（新增 dock 百分比与环形规格断言）、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 71/71`、`prompt-state 11/11`。

## E26. v0.23.0 头部状态摘要与趋势图可读性（2026-10-24）

- 头部：版本 chip 提高对比度；副标题从固定介绍改为实时摘要——会话、预算、已用、剩余、请求数——下方加 4px 使用率条。
- 趋势图：纵轴 0/中点/上限刻度与网格线；输入/输出改为真实色块图例（蓝/绿）；预算离峰值 ≤1.6× 时画预算线并标注，否则在右上角显示峰值/预算占比；X 轴改请求序号 `#n`，tooltip 保留 T 轮次、时间、输入/输出/合计；压缩点改橙色竖线 + 圆点；请求数改“40 / 200 次请求”。
- 实测：Desktop 0.2.1-rc.2 HMR；截图 [0.23-trend.png](ui/0.23-trend.png)。
- 测试：`static 83/83`（新增趋势图/头部摘要断言）、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 71/71`、`prompt-state 11/11`。

## E27. v0.23.0 DeepSeek 官方人民币峰谷计费（2026-10-24）

- 价目来源：[DeepSeek 开放平台 · 模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-10-24 抓取）。V4.1 Flash：缓存命中 ¥0.02/¥0.04、未命中 ¥1/¥2、输出 ¥4/¥8；V4 Pro：¥0.15/¥0.30、¥4.5/¥9、¥13.5/¥27（空闲/高峰，CNY / 1M tokens）。
- `metrics.js` 新增 `PRICING_META`、`isPeakTime()`（北京时间工作日 09:00–12:00、14:00–18:00），每条 assistant/compaction 事件按事件时间产生 `costParts`（input/cacheRead/cacheWrite/output），汇总到 `fold.cost`、日桶和 `summarizeFolds().kpi.costParts`；自定义 `modelPricing` 仍可覆盖。
- 状态接口下发 `pricing`（currency、models、peakNow、source、updatedAt）；概览新增计费卡，KPI 费用卡、页头、会话卡、趋势卡副标题/tooltip 都显示人民币费用。
- 测试：`static 86/86`、`metrics 31/31`（新增高峰 ¥10.04、空闲/周末 ¥5.02、成本拆分断言）、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`。
- Desktop 0.2.1-rc.2 实机：HMR 后概览计费卡显示 7 天 340M tokens 的 `¥17.01`（缓存命中 334M `¥6.68` / 未命中 5.1M `¥5.09` / 输出 1.3M `¥5.24`），当前时段为“空闲”，与官方 ¥0.02/¥1/¥4 一致；页头当前会话显示 `费用 ¥4.06`。截图 [0.23-billing.png](ui/0.23-billing.png)。
- 边界：费用按请求完成时间判定峰谷，法定节假日未单独扣除；Search/Fetch 未计；旧模型名沿用旧价。

## E28. 会话切换与概览去重（2026-10-25，Web 隔离 profile）

- 环境：Windows Desktop 资源里的 `dsh` CLI；把 `desktop` profile 复制为 `uitest` 后启动独立 Web 实例（`--profile uitest --port 0 --no-open`），插件仍指向已安装的 `dsh-plugins/agent-embodiment`；Edge headless + CDP 操作真实页面。
- 会话切换：点击左侧 `role=treeitem` 会话行，头部从新会话的 `已用 0 / 256K（0%）· 0 次请求` 切换为 `会话 Initialize project · 594 次请求 · 费用 ¥5.34`，再切回新会话恢复为 0；没有出现 A 会话标题配 B 会话请求数/费用的混合。
- 概览：去重后可见 KPI 带（6 项）、计费卡、单张每日 tokens 图和最近会话卡；没有旧的上下文大卡、活跃度热力图和费用 KPI。空会话不显示四个 0% 构成。
- 保护逻辑：`useLive` path 变化清空 + 请求路径守卫、dock 的 sessionId 守卫、`selected` 清空、inventory 草稿重置、`sessions` 晚注入补订阅；静态断言覆盖这些字符串与 `uiWorkspace.openSession`。
- 测试：`static 89/89`、`metrics 31/31`、`state 16/16`、`scaffold 146/146`。
- 边界：隔离 Web 实例对未加载进本进程的历史会话 `/live` 会返回 `unknown session`，此时头部走“累计 tokens”回退；真实 Desktop 的活动会话仍由 `/live` 提供实时用量。该实例是复制 profile，不是 Desktop Electron 窗口的截图验证。

## E29. 设置页与事件页压缩记录去重（2026-10-25）

- 设置 → 控制卡底部原先有可折叠的“压缩记录 N”，与“事件”页的“压缩与注入事件”读同一份 `control.log`，属于重复入口。
- 移除设置页这份副本；事件页保留筛选（全部/成功/失败）、成功/失败状态、前→后 token、目标、轮次/触发方式、耗时和注入计数。
- 静态断言改为“压缩记录只在事件页展示，设置页不重复”；`static 89/89`、`metrics 31/31`、`state 16/16`、`scaffold 146/146`。

## E30. 核心功能审计 P1 修复（2026-10-25，静态/集成测试）

- 会话排序：`index.js` 新增 `sessionsNewestFirst()`，analytics / `latestSession` / `/live` fallback 统一显式排序，不再依赖 `sessionQuery.listSessions()` / `sessions.list()` 的数组顺序。
- 自动挂载：只写已知 preset id（优先 `preset-standard`）；找不到时只告警；`mutatePreset` 保留已有控制行 config，停用再启用不会把 `mode` 等字段重置为默认。
- 全局工具状态：toggle / “恢复全部”同步 `setGlobalDisabledTools`，修复重置后 control 半侧仍读旧值的问题。
- 脚手架路径：拒绝任意盘符根，并把 Windows `SystemRoot` / `ProgramFiles` / `ProgramData` 纳入系统目录判断。
- 恢复全部：`clearSessionToggles` 同时清除会话提示词文本覆盖；面板确认文案同步。
- 费用标签：header 与会话卡统一显示“费用（估）”。
- 测试：`static 95/95`、`metrics 31/31`、`state 17/17`、`scaffold 146/146`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`。
- 边界：本轮是静态/集成测试验证，未重新做 Desktop/Web 端到端点击；P1-1 的排序在 provider 仅有 `createdAt` 时仍以创建时间近似“最近活动”。

## E31. v0.24.0 产品补齐与源码恢复（2026-10-25，静态/集成测试）

- 背景：0.24.0 的开发过程中，一次命令行文本改写把 `client.js` 的 UTF-8 内容写坏。恢复方式是从会话日志里取出 183 次 `edit` 调用，跳过已提交的 119 次，按顺序把 59 次未提交改动重放到 `git show HEAD:agent-embodiment/client.js` 上，最终文件通过 `node --check client.js`；不是从备份或构建产物还原。
- 首次运行引导：新增 `~/.dsh/agent-embodiment/onboarding.json` 与 `GET/POST status/onboarding`。引导三步为预算校准、压缩策略、控制行挂载授权；可跳过，之后仍能在设置里改。授权只记录同意，不等于控制行已挂载，面板与健康检查仍以 `control.active` 为准。
- 控制行默认不自动挂载：`autoMountControl` 默认 `false`，只有显式授权或用户在设置里启用自动压缩才补挂，写入后回读校验，失败写 warning 并在顶部提示条给出修复入口。
- 洞察与健康检查：新增纯函数 `insights.js`（`buildInsights` / `buildHealth`）和 `GET status/insights`；六条洞察规则 `tool-schema-share`、`unused-tools`、`repeated-compaction`、`compaction-failures`、`unknown-pricing`、`cost-outlier`，每条带可执行操作，直接跳到对应 tab 或设置项。
- 节省估算：`status/analytics` 增加 `savings { compactions, tokens, estimatedCost, currency, method }` 和 `coverage { total, scanned, withData, limit }`；节省 = 成功压缩的 `before - after`，按 DeepSeek V4.1 Flash 输入价折算，**不是账单退款**，未知模型不给估值。
- 数据管理：`GET status/export`（JSON 全量 / CSV 会话表，列含 tokens、缓存读写、工具调用、压缩次数、活跃时长、估算费用）与 `POST status/data/reset`（`logs` / `toggles` / `all`）；跨会话扫描默认 40 个会话，最大 200。
- 信息架构：侧栏从“智能体具身”改为 `Context` / `上下文`；面板固定 Overview / Trend / Events / Settings 四个 tab；脚手架从顶层 tab 下沉到 Settings → Labs；新增会话对比、会话详情费用拆分、自定义 `modelPricing` 编辑、告警提示条（设置 → 数据里可关）。
- 默认值调整：`triggerAt` 从 `0.75` 改到 `0.9`，`targetAt` 从 `0.5` 改到 `0.6`；`balanced` preset 同步为 `0.9 / 0.6 / keep 25%`。显式配置仍优先于 preset。
- 测试：`static 95/95`、`metrics 35/35`、`state 18/18`、`scaffold 146/146`、`insights 12/12`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`；`node --check index.js control.js client.js` 通过；`npm pack --dry-run` 20 个文件、约 163 kB（unpacked 约 564 kB），退出码 0。
- 边界：本轮是静态/集成测试与源码级验证，没有重新做 Desktop/Web 的端到端点击回归，也没有新的长时间压缩实测；`client.js` 恢复后的外观只在静态断言与语法层面确认。节省估算依赖日志里的压缩前后 token，缺记录时显示 `—` 而不是 0。

## E32. v0.24.1 WSL 端到端安装验收（2026-11-10，真实宿主）

- 环境：WSL `Ubuntu 24.04.4 LTS`（用户 `wu`），`node v26.10.0`，`dsh 0.2.1-rc.5`（`~/.local/bin/dsh`），`web` profile；插件 `0.24.1`，以 `link:/home/wu/dsh-plugins/agent-embodiment` 安装。
- 命令：`wsl.exe -d Ubuntu-24.04 -e bash scripts/wsl-verify.sh web` → 输出 `RESULT=PASS`；日志 `/tmp/embody-unit.log`、`/tmp/embody-int.log`、`/tmp/embody-install.log`、`/tmp/embody-web.log`。
- 单元：`static 98/98`、`metrics 42/42`、`state 18/18`、`persist 7/7`、`scaffold 146/146`、`insights 12/12`（共 323），在仓库检出目录跑。
- 集成：`control 54/54`、`smoke 72/72`、`prompt-state 11/11`（共 137），Cordis 由 `/mnt/e/tool/dsh/resources/app.asar`（desktop-runtime `0.2.2-rc.1`，Cordis 4.1.0）解出；**宿主是 0.2.1-rc.5，运行库是 4.1.0 交叉验证**，见下方边界。
- 安装：`dsh plugin --profile web remove agent-embodiment` + `add /home/wu/dsh-plugins/agent-embodiment` 成功；profile 清单登记为 `link:/home/wu/dsh-plugins/agent-embodiment`（原为 `link:/home/wu/dsh-context/agent-embodiment` 的 0.23.0；回滚命令 `dsh plugin --profile web add /home/wu/dsh-context/agent-embodiment`）。
- 真实启动：`dsh --profile web` 启动成功并打印 token；带 token 取 cookie 后 `GET /api/agent-embodiment/status` 返回 `version:"0.24.1"`、`control.active=true`；脚本随后停掉该实例（验收后 `pgrep` 无残留）。
- 首跑暴露并修复的脚本缺陷（`scripts/wsl-verify.sh`）：
  1. `set -u` 下引用未绑定的 `$LOCALAPPDATA`，脚本在第 3 步直接退出 → 改为 `DSH_ASAR` 优先 + `/mnt/c/Users/*/...` 路径通配；
  2. 单元套件在独立安装副本里跑会 `ENOENT .../README.md`（`static.mjs` 读 `../../README.md` 断言版本副本一致）→ 单元套件改在仓库检出目录跑，`node --check` 仍在安装副本跑；
  3. 安装后打印实际链接目标与回滚命令，避免“装到哪个路径”不可见。
- 矩阵：`0.2.1-rc.5` 加入 `dshReleases` 为 `compatible`；`0.2.2-rc.1` 仍为 `unknown`（Desktop 端到端未做）。
- 边界：本轮是“安装 + 启动 + 状态接口”级验收，**没有**在 WSL 面板里做点击/截图回归（引导三出口、真实压缩、CSV 导出仍未验）；集成测试的运行库（Cordis 4.1.0）与宿主（0.2.1-rc.5 自带 4.0.x）不同代，属交叉验证而非同宿主同库。

## E33. v0.25.0 真实缺陷修复与工程化（2026-11-10，静态/集成/行为级测试）

- 环境：Windows 工作区（Node 22.23.3），集成测试用 `E:\tool\dsh\resources\app.asar`（desktop-runtime `0.2.2-rc.1`，Cordis 4.1.0）解出的 `test/deps`；本轮**没有**重新做 WSL/Desktop 宿主级安装验收（见边界）。
- **发现并修复一个 0.24.0 起的致命缺陷**：`CtxPanel` 里 `const analyticsLimit = Number(budget.analyticsLimit)…` 早于 `const budget = …` 声明，函数作用域的 TDZ 让面板每次渲染都抛 `ReferenceError: Cannot access 'budget' before initialization` —— 四个 tab 整块变空，内部卡片级边界也救不了。此前 0.24.0/0.24.1 的静态（字符串断言）与集成（只加载模块、不渲染组件）测试都发现不了；WSL 验收只校验了状态接口，也没有打开面板。修复是把 `data` / `budget` 两行提到使用点之前，并新增行为级回归测试。
- 单元 375 项：static 101 / metrics 45 / state 26 / persist 7 / profile 11 / scaffold 146 / insights 16 / **render 23**。
- 集成 139 项：control 55 / smoke 73 / prompt-state 11。
- 行为级测试 `test/render.mjs`：最小 React mock（含 `Component`/`useState`/`useRef`/`useId`，`useEffect` 不执行以免真发请求）真正调用 `settings.section` 组件，断言四个 tab 都能渲染、tablist/tab/tabpanel 的 role 与 id/aria 关系、roving tabindex、←/→/Home/End 键盘切换、卡片边界的透传/降级/重试。TDZ 这类错误会在第一条断言直接暴露。
- P1 修复与证据：
  - 预算优先级：会话覆盖 > 控制行 `maxContextTokens`(>0) > 宿主 `contextWindowTokens` > 100000；`state 26/26`（8 条新增断言）+ `control 55/55`（控制行优先 / 为 0 时回退宿主）。
  - 鉴权失败关闭：有 `webServer` 无 `connection` → 403；`smoke 73/73` 新增断言（独立 Context 只挂 webServer，状态路由返回 `forbidden`）。`prompt-state` 因此补 `MockConnection`（真实 web profile 一定有 connection）。
  - 状态目录按 profile 隔离：`profile.js` 依据 profile 依赖指向识别，`test/profile.mjs` 11/11 覆盖 link / 普通依赖 / 不匹配 / 迁移不覆盖。
  - CSV BOM：`csvDocument()`，`metrics 45/45`（BOM、换行结尾、空数组）。
  - 价格表时效：`pricing-stale` 洞察（>30 天），`insights 16/16`（38 天触发、10 天内不触发、缺字段不误报）。
  - 兼容口径：状态接口下发 `compatibility { engines, releases }`；文档写清“范围 ≠ 验证”。
- 工程化：`oxlint`（`npm run lint`，配置 `.oxlintrc.json`，0 error / 0 warning，顺手清掉重复词典键与未使用变量）、lockfile + `npm ci`、CI 增加缓存/`concurrency`/lint；`wsl-verify.sh` 默认 dry-run（`--apply` 才改动）；analytics 基准 `scripts/bench-analytics.mjs` —— 40 会话 × 200 事件 P50 6.6ms / P95 12.4ms / RSS 46MB，200 × 400 P50 18.7ms / P95 62.4ms / RSS 85MB。
- 打包：`npm pack --dry-run` 22 个文件、178.7 kB（unpacked 600.8 kB），含 `profile.js`。
- 边界：本轮为静态/集成/行为级验证；**没有**在 WSL 或 Desktop 上重新安装 0.25.0 并点面板，0.2.2-rc.1 端到端仍未验收；`client.js` 拆模块（4054 行）本轮未做，只加了错误边界兜底。

## E34. v0.26.0 性能 / UX / a11y / 安全优化（2026-11-11，静态/集成/行为级测试）

- 环境同 E33（Windows 工作区 Node 22.23.3，集成用 `E:\tool\dsh\resources\app.asar` 的 Cordis 4.1.0）。本轮仍是静态/集成/行为级验证，未做 WSL/Desktop 宿主级安装验收。
- 单元 377 项：static 101 / metrics 45 / state 26 / persist 7 / profile 11 / scaffold 146 / insights 16 / **render 25**（新增 2 条：设置页 onboarding 重开入口、健康卡仍在）。
- 集成 139 项：control 55 / smoke 73 / prompt-state 11。`npm run lint` 0 error / 0 warning。
- 性能（静态分析，未做真实负载压测）：
  - `/insights` 与 `/analytics` 共享 5s 短缓存（`index.js` analyticsCache），Overview 打开时第二次请求命中，避免重复 `listSessions`+折叠+排序。
  - 前端 `/live` 飞行期去重（`client.js` fetchJson + inflightJson），CtxPanel 与 CtxDock 不再双拉同一会话；MutationObserver 节流 2s→3s。
  - compaction-log 截断到低水位 256KB（而非恰好 400 行），避免 512KB 边界反复全量读写。
- UX：onboarding「稍后」由 `dismissed:true` 改为 `deferredAt`（短时不再打扰）；新增 `POST /onboarding {reset:true}` + 设置页「重新打开设置」入口；401/403/5xx/网络错误映射为可操作文案（`client.js` humanizeError）。
- 口径统一：`tok`→`tokens`（含 `tokensShort` 词典值）；头部标注「插件预算」（`pluginBudgetTag`）。
- a11y：DailyChart / TrendCard 容器 `role="img"`+`aria-label`；SegmentedBar 阈值线补 `aria-label`。
- 安全：`metrics.js` 三处工具名计数容器改 `Object.create(null)`；PERMISSIONS 1.4/1.5 补 MCP command 与导出路径披露。
- 打包：`npm pack --dry-run` 22 个文件（未重新实测字节数，结构同 0.25.0）。
- 边界：`client.js` 拆模块、static 字符串断言换行为测试、Desktop 0.2.2-rc.1 端到端仍未做，留后续版本。

## E35. v0.26.1 面板渲染修复与 Desktop 0.2.2-rc.3 验收（2026-11-14）

- 触发：用户在 WSL 与 Desktop 上都遇到「侧栏有『上下文』入口、主区域空白」。加边界后页面给出 `本卡片渲染失败: t is not defined`，由此定位根因。
- 根因：`SegmentedBar` 的阈值刻度 aria-label 直接调 `t()`，组件作用域无词典函数。空会话走 `MeterBar` 分支，故此前所有测试（含 headless 探测）都命中不到该分支。
- 修复：文案改由调用方 `tickLabels` 传入；组件不再引用 `t`。同时把挂载幂等改为版本号 + 旧 bundle disposer 清理（解决 HMR 后空白），`CtxPage` 外增边界（失败可读）。
- WSL 验证（`dsh 0.2.1-rc.5`，隔离 profile `web`）：同步 → 安装 → 启动 → 状态接口 `version=0.26.1`、`profile=web`；headless Edge（1776×1250）点开面板：`panelCount=1`、`tabs=4`、`visible`、`0 error / 0 exception`。
- Desktop 验证（`@deepseek-ai/dsh-desktop 0.2.2-rc.3`，`C:\Users\40410\dsh-plugins\agent-embodiment` link 安装）：重启进程加载 0.26.1 后由用户确认面板四 tab 与内容正常；据此把 `0.2.2-rc.3` 加入 `dshReleases = compatible`。
- 测试：单元 393（新增 fetch-chain 3 / mount-guard 7 / locale-keys 6），集成 139（control 55 / smoke 73 / prompt-state 11），lint 0（含 `no-undef`）。
- 性能：`/status` 800ms 缓存绑定修订号（写入即失效，`?fresh=1` 绕过）；折叠缓存 TTL 60s、上限 60。
- 边界：Desktop 的面板确认来自用户目视（Electron 未暴露 renderer CDP，无法自动断言 DOM）；`client.js` 拆模块、41 条源码字符串断言替换仍未做。

## E36. v0.27.0 峰谷价修正与面板读写入口（2026-11-14）

- 环境：Windows 工作区（Node 22.23.3）；集成用 `E:\tool\dsh\resources\app.asar` 的 Cordis。
- 峰谷价：`isPeakTime()` 增加 `CN_HOLIDAYS`（2026 法定节假日静态表），节假日全天按空闲价；`estimateInputCost` / 逐条成本都走同一判定。`test/metrics.mjs` 新增 11 项（工作日高峰/午休/周末/国庆/春节/自定义表覆盖、自定义峰谷两档、平档回落）。
- 自定义价：`modelPricing` 行接受 `peak` / `offPeak`；`Config` schema 与 `POST /status/config` 均保留峰谷（此前被拍平为全天同价），非法峰谷段返回校验错误。
- 面板入口：新增 `POST /status/session-budget`（设置/清除会话预算覆盖，清除幂等），设置页新增「本会话预算」卡片；`test/smoke.mjs` 增加 5 项断言（设置 202、出现在 `sessionBudgets`、清除、非法 tokens 400、缺 sessionId 400）。
- 导出：JSON/CSV 改为二次确认后下载（文件含 cwd 绝对路径）。
- 测试：单元 404（metrics 56）、集成 144（control 55 / smoke 78 / prompt-state 11）、lint 0。
- 边界：节假日表为静态清单，跨年需更新；峰谷在 UI 里仍以平档编辑为主，峰谷两档通过配置文件写入。

## E37. v0.28.0 client.js 拆分与防漂移（2026-11-14）

- 背景：`client.js` 单文件 4310 行、75 个顶层函数，改一处要在 4000 行里定位；但 DSH 浏览器侧只加载一个文件且只能 `require('react')`，无法用打包器。
- 做法：按顶层锚点拆成 11 个片段（`client-src/00-head.js` … `90-apply.js`），`scripts/build-client.mjs` 按固定 ORDER 拼接；一次性拆分脚本 `scripts/client-split.mjs` 在拆完时断言**拼接结果与原文逐字节相同**（234,775 字节）。
- 防漂移：`test/client-build.mjs` 比对 `client.js` 与片段拼接结果，并检查片段目录里没有未登记进 ORDER 的文件；`scripts/bump-version.mjs` 同时改写片段与产物里的 `CLIENT_VERSION`。
- 验证：拆分前后 `client.js` 字节一致 → 单元 410（新增 client-build 6 项）、集成 144、lint 0（`client-src/**` 属片段，已在 oxlint 忽略）；WSL 实机面板 4 tab、0 异常。
- 边界：片段之间仍共享同一作用域（不是模块），跨片段的私有函数仍是隐式可见的；真正按模块隔离需要打包器，留待以后。

## E38. v0.29.0 节假日可配置与 0.2.2-rc.1 隔离验收（2026-11-14）

- 节假日可配置：新增 `holidays` / `holidaysIgnoreBuiltin` 配置；`metrics.js` 增加 `configureHolidays()` 与 `holidayInfo()`，`isPeakTime()` 默认取「内置 ∪ 配置」。`test/metrics.mjs` 新增 5 项（补充日期生效、合并语义、ignoreBuiltin 生效与失效、重置）、`test/static.mjs` 新增 5 项（格式校验、去重排序、非数组/非布尔拒绝）。
- 面板：模型价格卡只读展示「内置 31 天 + 自定义 0 天 = 31 天」；WSL 实机 `pricing.holidays = {builtin:31, custom:[], ignoreBuiltin:false, total:31}`。
- **0.2.2-rc.1 隔离验收**：在 WSL 用 `npm install @deepseek-ai/dsh@0.2.2-rc.1` 装进 `/tmp/dsh-rc1`（654 包），独立 `DSH_HOME=/tmp/dsh-home-rc1`，用 `--from-default-profile web` 建 `rc1` profile，`plugin add` 链接本插件（bundles 已登记），端口 3081 启动成功。
  - 状态接口：`version: "0.29.0"`、`budget.tokens: 128000`、`releases` 六项齐全。
  - 面板（headless Edge 1776×1250）：`tabs=4`、`version=0.29.0`、**0 error / 0 exception**，正文含「上下文 v0.29.0 正常 刷新 看清上下文花在哪…」。
  - 据此把 `0.2.2-rc.1` 从 `unknown` 改为 `compatible`。
- 观察（非缺陷）：该隔离实例的状态接口 `profile` 字段返回 `web` 而不是 `rc1`——profile 识别走的是「哪个 profile 的依赖指向本插件」，用默认模板克隆出的 profile 仍带模板名；状态目录因此落在 `profiles/web`，在隔离 `DSH_HOME` 下不影响隔离性，但与目录名不一致，留待后续统一。
- 测试：单元 422（static 104 / metrics 61）、集成 144、lint 0。

## E39. v0.30.0 峰谷价回归修复、Desktop 探针与写路由测试（2026-11-15）

- **修复的回归**：0.27.0 让配置层支持 `modelPricing[].peak/offPeak`，但设置在面板里的价格卡只映射 5 个平档字段；`POST /config` 是整段替换 `modelPricing`，于是在面板点一次保存就把 yml 配好的峰谷价静默拍平。改为「平档 + 峰谷两档」两组输入框，`pricingDraft()` / `pricingPayload()` 抽成纯函数，单填一半会提示而不是丢弃。
  - 行为级回归测试（`test/render.mjs`，29→36）：草稿保留峰谷、往返不丢、未配时不写空档、只填一半报 `incomplete`、清空即回全天同价。
  - 服务端回归测试（`test/smoke.mjs`）：带 `MockConfigEditor` 的隔离 Cordis 上下文里 POST 带 `peak/offPeak` 的补丁，断言落盘后两档仍在。
- **Desktop 探针**：client 挂载后写 `window.__agentEmbodiment = { version, panelId, slots, mountedAt, helpers }`。Desktop 的 CDP 只有 `dsh://host` inspector target、拿不到面板 DOM，此前只能人工确认；现在 `scripts/ui-check-panel.mjs` 输出 `probe` 字段即可断言版本与挂载状态。
- **补测试的路由**（此前零覆盖）：`GET /export`（JSON / CSV，含 UTF-8 BOM 与缺 `sessionQuery` 时 503 失败关闭）、`POST /config`（501 分支 + 202 成功路径 + `holidays` 校验）、`POST /config/preset`、`POST /data/reset`、`POST /onboarding`（405 只写 + reset 生效）、`POST /inventory/toggle`（非法参数 + 全局提示词开关被拒）、`POST /inventory/prompt/reset`、`POST /inventory/extra-prompt`(+reset)。smoke 78→103。
- 测试：单元 430、集成 169、lint 0。

## E40. v0.31.0 节假日覆盖提醒与词典清理（2026-11-15）

- **跨年静默偏差**：内置 `CN_HOLIDAYS` 只有 2026 年；到 2027 年若用户没在 `config.holidays` 补日期，节假日会被按工作日计价，且界面上看不出来。现在 `buildHealth()` 输出 `holidays` 检查项（`values: { year, years, builtinYears }`），未覆盖当年时面板健康卡显示「节假日表」为提醒态；该项与 `measurement` 都属于软提醒，不参与 `healthy` 判定，避免每年元旦整块面板变「异常」。
- 面板只读行加了「去 cordis.patch.yml 改 `holidays`」的指引，健康项也有了本地化标签（`healthHolidays`）。
- **死词典键清理**：用脚本比对 `t('literal')` 引用与词典键，37 个未引用键里 4 个（`compareTokens/Requests/Cost/Compactions`）实际是 `SessionCompare` 通过数组 + `t(key)` 动态使用的——先把它们改成字面量引用，再删掉其余 33 个。未引用键归零，`client.js` 235.5 KB（-2.7 KB）。
- 测试：单元 439（metrics 66 / insights 20）、集成 169、lint 0。

## E41. v0.32.0 DSH_HOME 隔离修复与 rc.1 复验（2026-11-15）

- **问题**：`index.js` 用 `homedir()` 硬拼 `~/.dsh`，忽略 `DSH_HOME`。E38 里「隔离实例的 `profile` 返回 web」不是识别逻辑错，而是**它读的是真实 home 的 profiles**；同时状态文件也被写进了真实 `~/.dsh/agent-embodiment/`，所谓隔离并不成立。
- 修复：`profile.js` 增加 `resolveStateRoots({ home, dshHome })`（`DSH_HOME` 优先），`index.js` 的 `BASE_STATE_DIR` / `LEGACY_STATE_DIR` / profile 识别根 / 脚手架路径守卫全部同源。
- 测试侧：本机环境 `DSH_HOME=C:\Users\40410\.dsh` 是设着的，修完之后 `smoke.mjs` 立刻红了（压缩日志写到了真实目录）——这正是修复生效的证据。`smoke.mjs` / `prompt-state.mjs` 现在额外 `delete process.env.DSH_HOME`，测试恢复 103/103 与 11/11。
- `test/profile.mjs` 11→18 项：`resolveStateRoots` 的默认/覆盖行为、legacy 目录名不变、以及端到端「同一插件目录在真实 home 里识别为 web、在隔离 `DSH_HOME` 里识别为 rc1」。
- 复验结果（0.2.2-rc.1 + `DSH_HOME=/tmp/dsh-home-rc1` + profile `rc1` + 端口 3081）：
  - 状态接口：`{"version":"0.32.0","profile":"rc1","controlActive":false}` —— **`profile` 从 `web` 变成 `rc1`**，与目录名一致。
  - 状态落点：`/tmp/dsh-home-rc1/agent-embodiment/profiles/rc1/`（11:37 新建）。
  - 真实 home 的 `~/.dsh/agent-embodiment/profiles/web/` 文件时间仍是 **11-14**，即本次运行没有再写进去（旧残留，修复前留下的）。
  - 面板：`tabs=4`、`version=0.32.0`、probe 版本一致、0 error / 0 exception。

## E42. v0.33.0 洞察规则扩展与安全复核（2026-11-15）

- 新增 4 条洞察规则（`cache-hit-low` / `near-limit-not-compacted` / `budget-unconfirmed` / `analytics-truncated`），卡片上限 7 → 10；`test/insights.mjs` 20→29 项，覆盖「触发」与「不触发」两侧。
- 发现并修掉一个既有缺口：`pricing-stale` 有 id 但面板 `insightText` 没有分支，卡片会渲染空文本；补上文案并新增 5 个词典键。
- `docs/security-audit.md` 增加 0.32.0 增量复核章节：新写路由 `POST /status/session-budget`（仅进程内、上限 200、不落盘）、`holidays` 与 `modelPricing[].peak/offPeak` 配置面的校验与体积上限、`window.__agentEmbodiment` 探针的暴露面评估、`DSH_HOME` 语义变化（共享目录会共享状态，与 DSH 一致）、脚手架守卫与状态根同源、导出二次确认、`?fresh=1` 只影响读取。剩余风险列了三条。
- 测试：单元 455（insights 29）、集成 169、lint 0。

## E43. v0.34.0 文档复核与模板引用一致性（2026-11-15）

- 复核 `PERMISSIONS.md` / `docs/LIMITATIONS.md` 共 15 处滞后，其中两处是**实质性错误**而非措辞：
  1. LIMITATIONS 写「没有 `connection` 服务时不拦截」，实际 0.25.0 起「有 `webServer` 无 `connection`」为 403 失败关闭——按旧文档会低估鉴权强度。
  2. PERMISSIONS 写「插件运行时代码不读取环境变量」，0.32.0 起会读 `DSH_HOME` 定位状态目录——按旧文档会漏披露。
  其余为路径（`~/.dsh` → `$DSH_HOME`）、节假日计价、自定义峰谷价、路由清单、Cordis 服务名（`sessions` → `sessionQuery`）、`engines.dsh` 与 `dshReleases` 的同步。
- 新增披露 `window.__agentEmbodiment` 探针：只读、含版本与两个价格换算纯函数，不含会话/token/路径。
- 模板结构校验：`test/scaffold.mjs` 已对 6 个模板逐项断言文件集、patch、skill 元数据、eval 用例与稳定性；本轮补 4 类**跨文件引用**断言（双份 skill 一致性、`.agents` 副本、文档不引用未挂载工具、README 不点名未生成文件），146 → 170 项。
- 结论：模板的**结构**已有较强保障，缺口在**任务质量**（`eval` 只记录 transcript、不判分），这一点在 LIMITATIONS 里保持如实标注，不能用结构测试代替。
- 测试：单元 479（scaffold 170）、集成 169、lint 0。

## E44. v0.34.1 路线图与核心审计对齐（2026-11-15）

- `RELEASE-PLAN.md` 的路线图停在「0.25.0 是当前工作区版本」，实际已到 0.34；补齐 0.26–0.34 五行状态与主题，1.0 门禁加入「独立安全审查」。
- 发布门禁里的回滚命令原为 `dsh plugin add agent-embodiment@0.21.0`——本项目从 0.29.1 起不再发布 npm，该命令已无法执行；改为 git tag + 本地路径安装，并保留 `clean-agent-embodiment-profile-patch.mjs` 清残留。
- `CORE-FUNCTION-AUDIT.md` 新增 0.3 小节：把 0.26–0.34 的 8 个真实缺陷做成「缺陷 / 根因 / 守卫」三列表，结论是这些都属于「实现自洽、测试全绿但用户可见结果错误」，共同守卫是行为级测试 + 真实数据夹具；P2-6（文档与测试边界滞后）标注为大部分已修复，仍存在的部分是文档手工副本漂移。
- 本轮只改文档，无运行时代码变更；版本号走 patch。单元 479 / 集成 169 / lint 0 与 0.34.0 相同。

## E45. v0.35.0 文档守卫与路由全覆盖（2026-11-15）

- 扫描结论：23 条注册路由中有 3 条从未被测试引用（`/inventory/reset`、`/inventory/prompt/session`、`/inventory/prompt/session/reset`）；`index.js::apply` 单函数 1695 行；代码里 0 处 TODO/FIXME。
- 补齐这 3 条后 **23/23 路由全部有测试引用**。其中「保存会话提示词」不只断言 202，还断言真的写进了 `state.js` 的会话文本表（`Map`，用 `.get/.size` 读），并验证按 name 清除与全清两种语义。
- 新增 `docs-guard.mjs`：把版本号、预算回退值、价格表日期、路由清单、兼容矩阵、零运行时依赖作为一致性断言，接入 `npm test`。首次运行即抓到 CLAUDE 概览版本停在 0.29.0、IMPLEMENTATION 漏 `/status/session-budget` 两个真实问题。
- `state.js` 的回退预算从字面量改为导出常量 `FALLBACK_BUDGET_TOKENS`，让守卫可以断言文档与代码用的是同一个数。
- 测试：单元 491（新增 docs-guard 12）、集成 181（smoke 115）、lint 0。

## E46. v0.36.0 拆分 apply 第一步：脚手架路由外置（2026-11-15）

- 背景：`index.js::apply()` 单函数 1695 行，同时装着状态初始化、23 条路由 handler、自动挂载与路径守卫；handler 无法脱离 Cordis mock 单测（smoke 因此要造 `MockConnection` / `MockConfigEditor` / `MockSessionQuery`）。
- 选择依据不是「挑最大的」，而是**按依赖数排序**：scaffold 三条路由依赖 0/1/2 个 apply 内符号，是最干净的第一块；`statusHandler`（70 行）依赖数十个，不适合先动。
- 结果：`routes-scaffold.js` 提供 `createScaffoldRoutes(...)` 与 `isProtectedScaffoldPath(...)`；`index.js` 从 2157 行降到 2032 行，`apply()` 1695 → 约 1570 行，行为未变（55/115/11 全绿）。
- 直接收益可见：新增 `test/routes-scaffold.mjs` 17 项，第一次可以在**不启动 Cordis** 的情况下测 handler 边界（含「生成真的写盘」「409 vs overwrite」「AGENTS.md 幂等 marker」）。
- 测试：单元 509、集成 181、lint 0。

## E47. v0.37.0 拆分 apply 第二块：会话类路由外置（2026-11-15）

- 沿用 E46 的选择方法（按依赖数排序），第二块取会话预算 / 数据清理 / 会话级提示词文本 / 新增提示词 6 条路由（依赖 2–4 个符号）。
- 需要注意的是 `extraPrompt` 两个 handler 原本直接读闭包里的 `runtimeExtraPrompts` / `runtimeExtraPromptPlacements`；直接传值会读到旧快照，因此改为 getter 注入 + 复用原 `writeExtraPrompts` 统一回写，语义保持一致。
- 结果：`routes-session.js` + `createSessionRoutes(...)`；`index.js` 2032 → 1964 行（起点 2157），集成 55/115/11 全绿。
- 新增 `test/routes-session.mjs` 28 项，覆盖此前只能经 HTTP + 完整 Cordis 间接碰的分支（数组 body、幂等清除、revision 递增、scope 组合、name 级与全清、409 无会话、placement 从 user 改回 system 时移除条目）。
- 测试：单元 537（新增 28）、集成 181、lint 0。

## E48. v0.38.0 运行时上下文层（2026-11-15）

- 目标：为把 `statusHandler`（70 行、依赖十余个闭包）搬出 `apply()` 铺路。先建层，不搬 handler。
- 做法：`runtime.js` 持有服务句柄、缓存/revision、运行时提示词状态、引导引用、路径与两个串行队列；`index.js` 的 200+ 引用点改为 `runtime.getX()/setX()`，删除 15 个模块级 `let`。
- 两个非机械决策：① `onboarding` 改为就地 `Object.assign`，因为 runtime 在它之前创建、若继续整体赋值会拿到旧引用；② 队列的「失败不阻塞后续」语义原样保留（`then(task, task)` + `catch(() => {})`），并写进单测。
- **过程中踩到的坑（已加断言防回归）**：批量替换把 `ctx.inject(['sessions'])` 里的服务名字符串也改成了 `RUNTIME.getSessions()`，导致注入回调不触发 → `connection` 恒为 null → 状态路由返回 403 `forbidden`，smoke 在解析 JSON 时炸掉。`static.mjs` 现在断言 `ctx.inject` 参数里不得出现 `RUNTIME`。
- 结果：集成 55/115/11 全绿；新增 `test/runtime.mjs` 35 项；单元 573。

## E49. v0.39.0 分析层外置（2026-11-15）

- 目标：搬 `statusHandler` 前，先把它依赖的 `analyticsPayload`（带 5s 短 TTL 缓存）与相关纯函数外置。
- 风险点与处理：`sessionTimestamp` 的取值优先级是 `lastActivityAt` > `updatedAt` > `createdAt`，且要兼容 `record.header` 与 `record.session.header` 两种形状。第一版实现凭印象写成了 `updatedAt` 优先，发现后改为逐字搬运——这类差异不会报错，只会静默改变会话排序。
- 顺带修掉 0.38.0 批量迁移留下的两处错误文案（用户可见的 `RUNTIME.getSessionQuery() unavailable…`）。
- 测试中新发现一个既有行为：`payload.range` 是区间对象而非请求字符串（因为 `...summary` 在赋值之后展开）。按零行为变化保留，并写进单测固定。
- 结果：`analytics.js`（纯函数 + `createAnalytics`）；集成 55/115/11 全绿；新增 `test/analytics.mjs` 27 项；单元 601。

## E50. v0.40.0 拆分完成：状态读取三路由外置（2026-11-15）

- P1.4 的最后一块。`status`(70 行) / `live`(44 行) / `export`(26 行) 移入 `routes-status.js`，`apply()` 里不再有 handler 实现。
- 三条 handler 的依赖都很少（8/6/3 个 apply 内符号），真正的难度不在体量而在「缓存与响应头必须逐字保留」：`?fresh=1` 绕过、`revision` 一致、`Date.now() - at < STATUS_CACHE_MS` 三个条件缺一个就会让面板读到陈旧数据或每次都全量重建。
- 新增 `test/routes-status.mjs` 24 项，第一次可以断言「revision 变化后缓存失效」与「`tokenMeter` 抛错时 live 降级为 `used: null` 而不是 500」——这两条以前只能靠真机观察。
- 累计效果：`index.js` 2157 → 1787 行；`apply()` 从 1695 行降到约 1300 行；新增 4 个路由模块（scaffold/session/status）+ 2 个领域模块（runtime/analytics），对应 111 项脱离 Cordis 的单测（17+28+24+35+27−10 重叠部分按实际计）。
- 测试：单元 627、集成 181、lint 0。

## E51. v0.41.0 control.js 分段评估与压缩规划外置（2026-11-15）

先做了评估再动手，结论与预期不同：`control.js` 的 `apply()` 有 525 行，但**只有 211 行是具名单元**（`syncGates` 108、`planRegion` 55、其余零散），剩下全是内联事件处理器——所以「按函数拆」最多挪走 200 行，真正的大块在订阅回调里：

| 订阅 | 体量 | 说明 |
| --- | --- | --- |
| `agent.ctx.on('system-prompt/assemble')` | 86 行 | section 重建 + 提示词覆盖/新增/禁用 |
| 两个 `sub.effect` | 各约 70 行 | inventory 侧注册与快照 |
| 三个 `agent/pre-step` | 41 / 68 / 29 行 | 测量、模式门禁、压缩触发 |
| `syncGates` | 108 行 | 全局+会话工具门禁合并 |

据此先切最干净的一块：`planRegion`（55 行，唯一外部依赖是读事件类型）。改为注入 `typeOf` 后整段是纯阈值数学，`control.js` 674 → 640 行，集成 55/115/11 全绿。

过程中还纠正了自己的两次错误：手算 `keepFrom` / `cut` 落点时把期望写错（实现是对的），以及第一版写了一条 `=== null || true` 的**恒真断言**——后者比写错更危险，因为它永远不会失败。已改成「`tool/call` 被过滤 → end 必须是 4」的真断言。

下一刀顺序（已写入 CHANGELOG）：`syncGates` → `assemble`（需先补 control 断言）→ inventory 注册。
- 测试：单元 644（新增 compaction-plan 17）、集成 181、lint 0。

## E52. v0.42.0 提示词装配外置（2026-11-15）

- 上一轮评估说 `syncGates`（108 行）是下一刀，实际读代码后发现它由两段组成：门禁同步约 20 行 + `system-prompt/assemble` hook 86 行。后者才是真正的大块，也更值得抽——因为它是「用户设的提示词覆盖/新增/禁用到底怎么生效」的唯一实现。
- 抽出 `buildAssembledSections(input)` 后，`control.js` 640 → 575 行，hook 缩到 20 行。集成 55/115/11 全绿，说明装配结果未变。
- 新增 28 项单测，其中几条是 control.mjs 覆盖不到的边界：frozen section 是否被就地修改（会污染宿主的 shared object）、会话覆盖与全局覆盖的优先级、旧前缀 `ctx-mon-and-con:extra:` 的禁用匹配、`interpolate` 字段是否被凭空添加。
- `static.mjs` 加了「不得再把 `const inventory = []` 写回 control.js」的契约断言，防止以后复制回去。
- 测试：单元 673、集成 181、lint 0。

## E53. v0.43.0 inventory 路由外置 + 洞察一键处理（2026-11-15）

- **inventory 路由组**：`inventoryHandler` / `inventoryToggleHandler` / `inventoryResetHandler` / `promptEditHandler` / `promptResetHandler` + `withLivePromptState` 移入 `routes-inventory.js`，`index.js` 1787 → 1681 行。抽取时发现 `insightsHandler` 也依赖 `withLivePromptState`，因此工厂同时把它导出，避免留下悬空引用（lint 的 `no-undef` 直接抓到）。
- **洞察一键处理**：客户端其实早就渲染了 `props.onOpen(insight.action)` 按钮，但 `openAction` 只处理 tab/锚点跳转，且 `insights.js` 的 `action` 全都是纯跳转——所以「点了没反应」的功能缺口在后端与执行端各一半。本轮加 `apply: {path, body, label}` 与 `applyInsight()`（POST + reloadAll），首批三条有明确修复动作的洞察接入。
- **模板冒烟（未完成）**：写了 `eval/deep/template-smoke.mjs` 并跑通流程，但 12 次运行全部 `MISSING_CREDENTIAL`：headless profile 解析 `DEEPSEEK_API_KEY`，本机桌面走的是 `llm-pi-ai` 账号路由，两者不通用。顺带发现 WSL 的 `/tmp` 会在实例空闲后清空，条件目录必须放持久路径（已改到 `~/.cache/embody-eval`）。
- 测试：单元 680、集成 181、lint 0。

## E54. v0.44.0 模板离线校验（2026-11-15）

E53 里模板冒烟因缺 `DEEPSEEK_API_KEY` 全线失败。与其等凭据，不如把「不需要模型就能验证的部分」做扎实：新增 `test/templates.mjs` 126 项，进 CI。

- 6 个模板 × 20 项结构断言：bundle 合法、skill 能被 `.agents/skills` 扫描到、frontmatter 完整、evals case 三件套齐全、无未替换占位、experimental 带警示。
- 一致性断言：同输入两次生成的字节必须完全一致——模板里混进时间戳/随机量会让提示词缓存全 miss，这条与 `prompt-state.mjs` 的模板稳定性断言互补。
- 过程中被两个真实结构纠正：`planScaffold().files` 是 `[{path, content}]` 数组而非对象映射；`evals/cases.jsonl` 的字段是 `id/task/expect` 而不是 `prompt`。第一版断言写错时是**测试报错**而不是静默通过，这正是它的价值。

结论：4 个 experimental 模板的生成物结构全部自洽（126/126）。这只证明「装得上、扫得到、跑得动脚本」，不证明「任务做得好」——后者仍需要真跑，即 E53 的阻塞项。
- 测试：单元 806、集成 181、lint 0。

## E55. v0.45.0 UI-PROPOSAL 与实现对齐（2026-11-15）

`docs/UI-PROPOSAL.md` 是最后一份没跟上的设计文档：§2 的问题清单写于 2026-10-18，§8 写于 0.24.0，之后面板改了十几轮都没登记。表面上它像「一堆待办」，实测发现有 12/14 条早已修掉。

核对方式不是读代码猜，而是逐条找证据：`styles.card` 是否还带 `flex`、图例是否 2×2 且带 `tabular-nums`、状态色是否用 `--dsw-alias-state-*`、折叠是否写 `localStorage`、`prefers-reduced-motion` 是否出现……由此得出「只剩两条未做」（`:focus-visible`、`prefers-reduced-motion`）。

顺带补登记了 12 个文档里没有的模块（`ControlSection`、`ConfigSection`、`KpiBand`、`BillingCard`、`DailyChart`、`SessionCards`、`TrendCard`、`EventsCard` 等），并把洞察从「6 条」更正为「11 条 / 展示 10 条 / 3 条可一键处理」。

最关键的一步是把核对变成断言：`static.mjs` 现在解析文档表格里的组件名，逐个校验 `client.js` 里存在同名函数，双向生效。以后要么改文档、要么改代码，不会再有「文档说是待办、其实早做完了」的错位。

过程中的一个工具坑：用脚本把多行 Markdown 拼进文档时，`join('\n')` 的内容被写成了逗号分隔的单行（`,## 9. ... ,,本文档...`）。改为「先用写文件的方式生成临时 md，再整段拼接」后正常——多行文本不要走字符串拼接。
- 测试：单元 807、集成 181、lint 0。

## E56. v0.46.0 独立安全审计 + 模板转正负结果（2026-11-15）

### 独立审计

按 1.0 门禁补做独立审计（全新上下文、看不到实现过程的 agent）。结论「有条件发布」：鉴权、fail-closed、体积上限、文件级路径逃逸、备份回落实测成立，同时给出 1 high + 2 medium + 6 low。**9 条全部复现、全部修复、全部加了回归断言**（`test/security.mjs` 21 项）。

最有价值的一条是 F1：高危不在「路由鉴权」层，而在**产物层**——把不可信输入写进「以后会被执行的配置文件」（bundle patch 的 `!!js` 面）比直接执行更隐蔽。F2 也有代表性：路径守卫看着是白名单，实际是字符串前缀比较，在大小写不敏感的文件系统上等于没防护。

独立视角确实有效：它一次就找出作者自审 7 节里没有的 4 类问题（缓存上界、文本上限、写队列绕过、文件名回显）。作者自审容易停在「我设计时想到了什么」，独立审计会问「实际传进去会怎样」。

顺带修掉一个一直被旧测试掩盖的真实 bug：导出文件名在生产环境是 `[object Object]`（`payload.range` 被 `...summary` 覆盖成区间对象），旧测试用假 payload 断言，所以没发现。

### 模板转正：负结果

给 `ops-runbook` / `browser-operator` 各出 3 道定位题 + `base` 对照。**第一轮跑出来的「ops-runbook 回归」是假的**，三个失败全是我出题的错：

1. `forbidden` 用裸关键词匹配——模型写「No reboot, and no restarting before `nginx -t` passes」是正确回答，却因出现 "reboot" 被判违规。
2. `tpl-ops-01` 的 gold 标 `09:42:11`（开始拉取），但「首个异常事件」是 `09:42:58` 的 `Back-off pulling image`。
3. `tpl-ops-02` 的 gold 标 `07:57:00`（waiting=17），但 `07:56:50`（waiting=2）才是首次饱和。
4. 参数题 gold 写死 `max_connections`，模型答 `statement_timeout` 同样合理。

修正后想重跑时配额用尽（`GoUsageLimitError`），于是用修正规则对已存答案**离线重判**（答案全文在 jsonl 里，重判是确定性的）。结果：ops 两组都 3/3（无区分度），浏览器 base 2/3 → browser-operator 3/3（救回 1 道）。结论是两个模板都不转正。

```
| 条件                        | 题数 | 正确 | 逐题                     |
| ---                        | --: | --: | ---                      |
| ops: base                   |  3  |  3  | 01:✓ 02:✓ 03:✓           |
| ops: ops-runbook            |  3  |  3  | 01:✓ 02:✓ 03:✓           |
| browser: base               |  3  |  2  | 01:✓ 02:✓ 03:✗           |
| browser: browser-operator   |  3  |  3  | 01:✓ 02:✓ 03:✓           |
```

教训：**先验证题目难度再谈结论**。`base` 能全对的题，无论模板组表现如何都不能作为证据；`forbidden` 只该放「答错就必然出现」的错值，题目自己说了「不要 X」时，正确回答必然会提到 X。

- 测试：单元 829、集成 181、lint 0。

### 附带一个 CI 教训（本版本内修复）

0.46.0 首次推送时 CI 三个 Node 版本的 unit job **全挂**，而本机全过。原因：`test/security.mjs` 用 Windows 路径（`c:\windows\system32`、`\\?\C:\Windows`）断言「受保护」，Linux runner 上 `process.platform !== 'win32'`，这些分支根本不生效，断言必然失败。

修的时候发现两边都得改：

- **测试**：路径断言按平台分流（win32 用大小写/设备前缀/8.3，POSIX 用 `/etc`、`/root`、`$HOME`），并把两个列表等长化，保证两端断言数一致（22/22）——否则文档里的基线总数会随平台摇摆。
- **实现**：8.3 短名保护原本在**所有**平台生效，而 POSIX 上 `~1` 是合法路径字符，会误拒正常工作区。改为只在 win32 判定。

教训：**「本机全过」不等于 CI 会过**。凡是涉及路径语义、大小写、文件系统特性的断言，必须在写的时候就想清楚它在另一个平台意味着什么；等 CI 报错再改，等于多花一轮往返。

本地双平台验证：Windows 22/22、WSL/Linux 22/22。

## E57. 评估环境里的明文凭据副本（0.46.0 后续修正，2026-11-15）

这件事**不是审计发现的**，是用户一句「模板转正为什么需要独立配置一个模型」问出来的。

追下去发现 `eval/deep/setup-conditions.mjs` 会把 `~/.dsh/.credentials.yaml` **复制**进每个隔离 `DSH_HOME`。实测已经在磁盘上留下 3 份明文密钥副本（`probe`、`base-home`、`plugin-home`），全部含完整的 key 集合。

刚做完的独立安全审计专门列了「凭证泄漏」这一类，而我在评估脚本里批量复制密钥——**审计范围只覆盖插件运行时代码，没覆盖 `eval/`，所以两边都没发现**。

顺带查出同一脚本的三个设计问题，都属于「没想清楚哪个变量该控制」：

| 问题 | 后果 |
| --- | --- |
| 复制 `.credentials.yaml` 进每个 home | 明文密钥多份副本；副本指向同一账号，评估烧的是同一份额度 |
| 把 `contextWindow` 缩到 40000 并加激进 compaction | 这套 tuning 是为 compaction 实验准备的；模板题不涉及压缩，套用它引入了无关变量 |
| 建 `base-home` + `plugin-home` 两套 | 模板评估只改 `DSH_AGENTS_HOME`，`DSH_HOME` 可以完全相同，第二套是多余的 |

修正：

- 新增 `eval/deep/template-conditions.mjs`：**单套 home、不 tuning、不复制凭据**。
- `setup-conditions.mjs` 改为默认不复制凭据（`--copy-credentials` 才复制），头部注释写明 tuning 只适用 compaction 类实验。
- 已删除那 3 份明文副本；验证方式是删掉后跑一轮——不再 `MISSING_CREDENTIAL`，而是直接打到 API（当时报配额 429），证明 `apiKeyEnv: OPENCODE_GO_API_KEY` 只要环境变量就够。

教训：**安全审查的范围要和代码的范围一致**。审计了插件、漏了评估脚本，等于给了自己一个不受审的后门；而「在别处复制一份凭据让它跑起来」这种便利写法，恰恰是最容易被略过的一类问题。

- 插件运行时代码本轮无改动；测试基线不变（单元 829、集成 181、lint 0）。

## E58. v0.47.0 键盘焦点环 + 一处自查更正（2026-11-15）

UI-PROPOSAL §9 里剩的两项，一项真做、一项早就做了。

**焦点环**：行内样式表达不了 `:focus-visible`，改用 0.14.19 就有的 `<style>` 注入方式，作用域只匹配插件自己的 `data-embodiment-*` 标记。用 `:focus-visible` 而不是 `:focus`，鼠标点击不会多出焦点环。

**`prefers-reduced-motion` 其实早做了**：我在 §9 判它「未做」，但同一份文档 §6 第 104 行写着 v0.14.19 已实现。错因很具体——核对时只 grep 了 `20-styles.js`（样式对象），而它是在 `90-apply.js` 里运行时注入的。

这条值得记的原因不是「小疏忽」，而是它暴露了核对方法的问题：**同一个能力可以有三种实现路径**（行内样式 / 注入 `<style>` / 组件内事件处理），只查其中一种就会得出相反结论。所以这次把断言补上——`static.mjs` 现在会检查两段 `<style>` 都存在、作用域正确、且在 `dispose` 时移除，以后无论谁再改都有兜底。

§2 的 14 条问题至此全部落地。
- 测试：单元 833、集成 181、lint 0。


## E59. v0.48.0 决定不转正那 4 个模板（2026-11-15）

用户问了一句「模板题有什么用，是必须的吗」，把这件事问清楚了。

**它不是必须的。** 4 个模板标着 `experimental`（＝未做任务验证），标注本身就是如实披露；1.0 门禁也不含「模板必须转正」。题目只服务「要不要转正」这一个决定，不转正就没有价值。

而实际结果更直接：**两轮评估都没有回答它要回答的问题**。第一轮 3 题饱和（不挂模板也全对）；第二轮换成历史上 `base` 会错的题，修完我自己的判分错误（`forbidden` 用裸关键词误伤「No reboot」、两个 gold 时间戳标错）之后，两组仍是同样的分数。投入了配额、返了工，结论是「测不出来」。

顺带把「为什么要另起一个 dsh 调 API」也问明白了：`run.mjs` 其实没有裸调 API，它 `spawn` 了一个 `dsh --profile headless --json` 子进程再解析事件流。但确实是**另一个 dsh 实例**（自己的 `DSH_HOME`、profile、key 解析），看起来就像另搞一套——而那是设计选择，不是必需。

于是决定：**保持 `experimental`，停掉任务级评估**。结构校验（126 项，不需要模型、每次 PR 都跑）留下，它回答的是另一个问题——「装得上吗」。

保留 / 归档的划分：

| 保留 | 归档（`eval/deep/archive/templates/`） |
| --- | --- |
| `test/templates.mjs` 126 项结构断言 | `questions-templates.jsonl` 6 道题 |
| 6 个模板本身的可用性 | `template-smoke.mjs`、`template-conditions.mjs` |
| — | 两份实验记录 + 三份原始结果目录 |

归档目录的 `README.md` 记着停掉的理由、以及将来重开时必须先读的两条硬教训（先验证题目难度；`forbidden` 只放「答错就必然出现」的错值）。

这条决定本身值得记的原因是：**能判断「不做什么」和判断「做什么」一样重要**。前几轮我一直在给这件事加投入（写题、修判分、换环境），却没有先问「这个结论值多少钱」。

- 测试：单元 833、集成 181、lint 0。

## E60. v0.49.0 技能目录（只读）（2026-11-16）

需求是「给插件加技能管理」。先把宿主能力读清楚再定范围，结论是**只读这一层现在做**，启停与编辑不做。

### 宿主侧的事实（读 app.asar 得出，不是猜的）

- 技能由 `ctx.skills` 注册表提供（`@deepseek-ai/dsh-skill` 拥有 Service Definition），`dsh-skill-filesystem` 以 provider 身份注册。
- 根目录按 rank 扫：`.dsh/skills`(100)、`.agents/skills`(200)、`custom`(300)、`~/.dsh/skills`(400)、`~/.agents/skills`(500)、bundled(600)。
- 注册表只有三个读方法：`list(options)`、`snapshot(options)` → `{ skills, complete }`、`get(name, options)` → 含正文的完整定义。
- 每个技能带 `invocation: { modelInvocable, userInvocable }`，值来自 `SKILL.md` 的 `disable-model-invocation` / `user-invocable`。**注册表没有按会话过滤的接口。**

### 为什么只做到只读

「按会话启停技能」听着自然，但宿主的 invocation 是**文件属性**，不是运行时开关。硬做只能注册同名 runtime stub 去遮蔽 provider 的候选（`runtime` rank 250 优先），代价是遮蔽后正文也取不到、语义变成「假装没这个技能」。那不是管理，是 hack，所以没做，只把边界写进 `LIMITATIONS.md`。

### 踩到的坑：宿主平面读不到技能的真正原因

第一版直接用 `ctx.skills.list()`。桌面/WSL 上装了插件、`~/.agents/skills` 里明明有 5 个技能，接口却稳定返回 `total: 0`、`complete: true`。

原因不是「宿主没挂 provider」，而是**作用域**：注册表的 provider 注册在 agent preset 的作用域层，`list()` 不带 `scope` 时只读全局层；要读 preset 层就必须传 `ScopeKey`，而 `ScopeKey` 是 `dsh-scope` 里 `Symbol('dsh.scope')` 上的**模块私有**值——插件又按「运行时不 import 任何 npm 包」运行（`link:` 安装解析不到宿主依赖），根本拿不到它。

这一步是靠「装上去真跑一次」发现的。单测全绿、接口 200、`complete: true`，但内容是空的——**空结果比报错更危险**，它看起来像成功。

### 解法：两条取数路径 + 如实标注来源

| 路径 | 何时 | 能力边界 |
| --- | --- | --- |
| 注册表（`via: registry`） | 能读到就用，权威 | 含 runtime 技能、preset `customSkillDirs` |
| 目录扫描（`via: filesystem`） | 注册表在全局层为空时 | 只覆盖 4 个标准根，看不到 `customSkillDirs` |

面板把 `via` 显示成「来源：宿主注册表 / 目录扫描」，不假装两者等价。扫盘规则对齐宿主：只扫顶层、目录包 `<name>/SKILL.md` 或扁平 `<name>.md`、同名按 rank 先到先得、跳过 `.system`。

### 真实数据又抓到一个 bug

扫盘上线后列出 6 个，但 `~/.agents/skills/humanizer-zh` 是**指向目录的符号链接**，被漏了：`Dirent.isDirectory()` 对符号链接恒为 `false`，我按「不是目录就当扁平 .md」处理，名字不以 `.md` 结尾就跳过了。改为对链接 `stat` 一次再判断，悬空链接跳过。修完 7 个，`humanizer-zh` 正文 7825 字符可取。

### 另外两个被工具纠正的地方

- `docs-guard` 在我漏写 `/status/skills/body` 时直接失败（`IMPLEMENTATION 覆盖全部注册路由`），说明「文档路由清单 vs 代码注册」这条一致性断言在起作用。
- 第一版超时计时器加了 `unref()`，测试表现为「顶层 await 悬挂、进程直接退出」：unref 的计时器不保活事件循环，可能在触发前就没了。被「注册表卡住」用例当场抓到，改成不 unref 并把超时做成可注入（测试用 40ms）。

- 测试：单元 898（`routes-skills` 62、`static` 121）、集成 181、lint 0。


## E61. v0.50.0 技能视角接入 preset 作用域 + 一处误判更正（2026-11-16）

这一轮是「优化新加的技能功能」，但最有价值的产出是**发现我上一轮的一个判断是错的**。

### 先说错在哪

0.49.0 的 E60 写着「preset 配了 `customSkillDirs`，模型能看到 11 个而面板只有 7 个」。查证后：**那是另一个 preset 的配置**。这个 profile 里有两个 `skill-filesystem` 行——

| 行 | 所属 | 配置 |
| --- | --- | --- |
| 第 55 行 | 第一条 preset（我们的 control 也在这里） | 无 `customSkillDirs`，只有默认根 |
| 第 542 行 | video-production bundle preset | `customSkillDirs: .../bundles/video-production/skills`（4 个技能） |

当前会话跑的是第一条 preset，它有 7 个（2 个探针项目 + 5 个用户级）。**面板的 7 个是对的**，我把「另一个 preset 的目录」当成了「模型此刻也能看到的目录」。

### 真正的缺陷是另一个

注册表在**全局层**读出来是 0。因为 provider 注册在 preset 作用域层，`collectFresh` 用的是 `options.scope`，不给 scope 就只读全局。所以 0.49.0 的 7 个其实是**目录扫描的近似结果**，不是宿主的答案。

### 拿到 scope 的办法

`ScopeKey` 是 `dsh-scope` 里 `Symbol('dsh.scope')` 上的模块私有值，插件不 import 任何 npm 包，正常拿不到。但在真实 Cordis 上打样验证了一件事：`ctx.extend({ [kScope]: key })` 打出来的符号属性是**可枚举的**（`Object.getOwnPropertySymbols` 能看到，值原样取回，root 上没有），而且 scoped ctx 上只有这一个自有 symbol。

于是：只有运行在 preset 作用域内的 `control.js` 手里有那个 ctx。它枚举自有 symbol 值作候选，**用注册表实测「哪个候选能多列出技能」**（不是靠符号名字猜），验证通过才写共享 `state.js`，宿主半侧读来传 `snapshot({ scope })`。传错候选也只是查不到层——`chainLayers` 对陌生 key 是安全的全函数。

实测结果：`via: registry`、`scopeApplied: true`、7 个，来源 `project-agents` + `user-agents`。数据从「扫盘近似」升级成「宿主答案」。

### 启动瞬间的过渡态

实测：进程刚起来、注册表服务还没被我们的 `ctx.inject(['skills'])` 回调拿到时，第一次 `/status/skills` 是 `via: filesystem`（扫盘近似）；几秒后同样的请求变成 `via: registry`、`scopeApplied: true`。不假装这是缺陷——响应把两种状态都标出来了，面板照着显示「来源：目录扫描 / 宿主注册表」，用户不会误以为看到的是权威结果。

顺带修了一个真 bug：第一版在 `apply` 里直接读 `ctx.skills`，Cordis 直接抛 `cannot get property "skills" without inject`，`test/control.mjs` 当场抓到。改成 `ctx.inject(['skills'], …)` 晚绑定。

### 体验三项

筛选框（>6 个技能才出现）、按来源根分组（`source · 数量`）、每行「复制路径」。`scopeApplied === false` 时明说「宿主目录里可能还有更多技能没列在这里」——这是对「空结果看起来像成功」那道教训的正面处理。

### 一处如实记录的取舍

想给分组/筛选加行为级测试，但现有 `render.mjs` 的 mock **到不了 Settings 分支**（`tab` 是 `CtxPanel` 的第一个 `useState`，槽位注入不可靠，点 tab 的 onClick 也不生效）。没有硬凑，改成源码级断言 + 把缺口写进 `LIMITATIONS.md`。测试基建的债要还，但不在这一轮。

- 测试：单元 905（`routes-skills` 67、`static` 126）、集成 181、lint 0。

## E62. v0.50.1 把「测不到」修成「测得到」（2026-11-16）

上一轮我记录了一条诚实但没解决的问题：技能卡片的「分组 / 筛选 / 复制」只有源码断言，因为「`render.mjs` 到不了 Settings 分支」。这一轮去修，发现**结论只说对了一半**。

### 三层障碍，一层层剥

1. **找不到 tab 按钮**：我按 `id` 里含 `settings` 去匹配，实际标记是 `data-embodiment-tab`。
2. **点了不生效**：`makeReact` 的 `cursor` 跨渲染不重置。第二次渲染从上次的号继续，同一个组件的 `useState` 落到新下标，切了 tab 也读不回来。补 `__resetCursor()` 后，实测 hook 轨迹变成了 `r1 use1="settings"`。
3. **切过去了仍是空的**：这才是我上一轮没查到的真因——harness 只产出**顶层**元素树。卡片是 `h(SkillsCard, …)` 这样的**组件元素**，没有调和器就永远不会被调用，卡片内部的标记自然一个都看不到。给一份打了探针的副本才定位到：`body` 长度已经是 9（卡都在），但看到的树里没有它们的输出。

补 `renderDeep`（递归调用函数组件与 class 组件的 `render()`）之后，Settings 里的卡片第一次真正被渲染。

### 一条我特意删掉的假断言

第一版我给自己加了一条「筛选后行数减少」，但根本没实现筛选——它只是把同一份全量 payload 又渲染了一遍，数字碰巧对。这种断言比没有更糟：它会让下一个人以为筛选被测过。删掉，改成只断言「筛选框在 >6 个技能时出现」，并把「输入交互未测」写进 `LIMITATIONS.md`。

要真测筛选，得能让卡片独立挂载（导出卡片，或用 per-component 的 hook 游标），那是结构改动，留到下一轮。

- 测试：单元 924（`render` 55）、集成 181、lint 0。

## E63. v0.50.2 把最后一处测试欠账结清（2026-11-17）

0.50.1 留下的唯一欠账：技能筛选框的**输入交互**没测，理由是「要给卡片注入 `query` 得先数出面板用了多少个 hook」。

### 修法：hook 状态按组件隔离

真实 React 每个组件实例一份 hook 链表，序号从 0 起。mock 之前是「整棵树一个游标」，所以卡片是第几个被调用、用了几个 hook，全看面板结构——注入点必然脆弱。

改成 `makeReact(initialStates, componentStates)`：顶层仍用数字下标（旧调用不动），组件级按名字注入。`renderDeep` 在调用组件前 `__enterComponent(name)`、之后 `__exitComponent()`，组件内游标归零。于是可以写：

```js
makeReact({ 0: readyStatus }, { SkillsCard: { 3: 'delta' } })  // 卡片第 4 个 useState = 筛选值
```

**面板结构变了也不会失效**——注入的是「这个组件的第几个 hook」，不是「整棵树的第几个」。

### 两处自己写错、被测试当场抓住的

1. `renderWithQuery` 忘了注入 status。面板 `state.phase !== 'ready'` 时走 loading 分支，卡片根本不存在 → 断言拿到 `null`。表现是「按来源过滤」那条先崩，报 `Cannot read properties of null`。
2. 我先写了条「按来源文本过滤会命中该组」，跑出来是 0 行——因为实现里筛选只看 `name` / `description` / `whenToUse`，**不看 `source`**。这不是 bug，是断言写错了。改成正面钉住这条边界：「筛选不匹配来源名」。

### 现在这一片是什么状态

卡片的分组 / 筛选 / 复制路径 / 徽章 / 数据来源提示**都有行为级断言**。测试从 36（0.50.0）→ 55（0.50.1）→ **61**（本轮）。

产品代码在这三轮里一行未改——所有修正都在 harness 与测试侧。

- 测试：单元 930（`render` 61、`static` 126）、集成 181、lint 0。

## E64. v0.50.3 把「重复劳动」变成「自动化」（2026-11-17）

这一轮不做新功能，做的是**让我自己少犯错**的三件事。

### 1. docs-guard 覆盖到另外三份版本副本

以前它只断言 6 处（client 两份 CLIENT_VERSION、三份 README/IMPLEMENTATION、CLAUDE）。`CHANGELOG` / `RELEASE-PLAN` / `EVIDENCE` 一直靠手工同步 —— 而这三轮里我确实漏过（0.50.0 漏 CLAUDE，是 docs-guard 抓到的）。

新加三条，**加完立刻抓到一处真滞后**：

```
FAIL - RELEASE-PLAN 标注的「当前版本」覆盖 package.json 版本
  {"version":"0.50.2","row":"| `0.34.0`–`0.34.1` | patch | **当前版本** | ..."}
```

那份路线图停在 0.34.1，后面 0.35 → 0.50 十几版全没记 —— 而它还把 0.34.1 标成「当前版本」。这种滞后比漏写更糟：读的人会以为当前就是 0.34.x。已补齐五行。

### 2. 新断言做了反向验证

把 RELEASE-PLAN 的「当前版本」行改回 `0.34.0–0.34.1` 再跑 → docs-guard 立刻红；还原 → 恢复全绿。

**不验证这一步的话，一条永远通过的断言比没有更糟**——0.50.2 那次我就写过一条「筛选后行数减少」，其实没实现筛选、数字碰巧对。

### 3. 部署脚本固化，并且第一次跑就踩了自己的坑

`scripts/deploy-plugin.sh` 默认演练、`--apply` 才拷，排除项只写一处。第一版用 `${USER}` 猜 Windows 用户目录，演练输出直接暴露：

```
Windows → /mnt/c/Users/wu/dsh-plugins/agent-embodiment   ← 错了
```

WSL 用户名是 `wu`，Windows 账户是 `40410`。改成按目录特征探测（`Desktop/context/agent-embodiment`），现在正确指向 `/mnt/c/Users/40410/...`。

### 4. 接口不一致

`/status/skills/body` 补上 `scopeApplied`（列表一直有）。前端要判断「视角是否完整」时不必再两套逻辑。

- 测试：单元 932（`docs-guard` 15、`routes-skills` 68）、集成 181、lint 0。

## E65. v0.50.4 CI 覆盖 Windows（2026-11-17）

这个插件的主要运行环境是 Windows 桌面版 DSH，但 CI 一直只有 `ubuntu-latest`。平台差异（路径分隔符、大小写、进程权限、换行符）全靠我每轮手工在 Windows 上跑一遍单元。

### 加了什么

`unit-windows` job（`windows-latest`，Node 22）：`node --check` + `npm test` + `npm run lint` + 一条换行符守卫。集成 job 不变——它需要本机 `app.asar`，CI 里没有。

三个决定：

| 决定 | 原因 |
| --- | --- |
| 只跑 Node 22 | 平台相关的坑与 Node 版本基本无关；三档一起跑意义不大还费额度 |
| `shell: bash` | runner 自带 Git Bash，命令语义与 ubuntu job 一致，避开 PowerShell 对 `&&` 与引号的处理差异 |
| 单独的换行符守卫 | `client-build` 是字节级比对；检出若被转成 CRLF，失败信息会指向构建脚本而不是换行 |

### 过程中把一个文件写坏过，而且是同一个坑踩了两次

第一次插入 job 用 `String.replace(原文, 替换文本)`，替换文本里含**美元符紧跟单引号**——JS 会把它当成「匹配之后的全部内容」，直接把 workflow 接成半截。`git checkout` 还原后改用函数式拼接，才写对。

第二次是在写这份 EVIDENCE 的脚本里，同样的字符组合把脚本自己弄成语法错误。所以这段文字现在改用文字描述那个字符组合，不再直接写它。

顺手把 shell 里的同类转义也换掉了：换行符检查改用 node 读文件判断 `charCode 13`，不依赖 shell 的引号规则。

插入后做了 YAML 解析校验（WSL 的 `pyyaml`）：`jobs: [unit, unit-windows, integration]`，`unit-windows` 7 个 step。

## E66. v0.50.5 Windows CI 第一次跑就抓出真缺陷（2026-11-17）

0.50.4 加了 `unit-windows` job，第一次跑就红了。**它抓到的不是 CI 特有问题，而是真实用户会踩的缺陷。**

### 拿不到日志，怎么定位

未鉴权访问不到 job 日志（`/actions/jobs/{id}/logs` 返回 403），也没有 `gh`/token。两步间接取证：

1. **把 `npm test` 拆成逐文件 step**：失败 step 的名字就是文件名 → `test routes-scaffold` 失败。
   （第一次拆错了：`indexOf` 命中 ubuntu job 里同样的 `- run: npm test` 文本，改成先定位 `unit-windows:` 段落。）
2. **把断言失败输出成 GitHub annotation**（`::error title=...::`）：annotation 通过 job 的 `check_run_url` 能读到，不需要日志。于是拿到具体哪几条断言失败，再往测试里插一条临时探针把实际路径打出来。

### 真因

```
tmpdir = C:\Users\RUNNER~1\AppData\Local\Temp     ← 8.3 短名
isProtectedScaffoldPath(...) = true               ← 被判受保护 → 生成返回 400
```

守卫里有一条规则：「8.3 短名（`PROGRA~1`、`RUNNER~1`）一律按受保护处理」。当初的考虑是「无法展开就不能猜」。问题是**长用户名下的 Windows 用户，`%TEMP%` 本身就是短名路径** —— 这些人做脚手架会一直 400，而错误信息只会说「目录受保护」，完全指不到真实原因。

### 修法

先展开、再比较：把路径中**已存在的那一段**用 `realpathSync.native` 展开成长名（目标目录通常还不存在，所以从目标往上找第一个存在的祖先，剩余段接回去），然后所有比较都用展开后的路径。

安全语义没放松：

| 情况 | 结果 |
| --- | --- |
| 展开成功，落到临时目录 | 放行 |
| 展开成功，落到 `C:\Windows` / Program Files / home | 仍拒绝 |
| 展开失败，或展开后仍带 `~N` | 仍拒绝（无法确定就不猜） |

附带收益：中间的 junction / 符号链接也会被解开，指向系统目录的链接照样判受保护。

### 验证

- 新增 4 条断言（注入 `expand` 覆盖确定行为）：可展开放行 / 展不开拒绝 / 展开到系统目录拒绝 / 展开到 home 拒绝。
- 另用本机真实短名手工验证：`C:\PROGRA~1\some\dir` → `true`（展开成 `C:\Program Files`），临时目录 → `false`。**这一步是为了确认走的真是文件系统，而不是我注入的假函数。**

- 测试：单元 936（`routes-scaffold` 21）、集成 181、lint 0。

## 已知限制（unknown）

- 未进行独立安全审计；本文件不声称“安全通过”。
- 未对 `0.2.0-rc.1`、`0.2.1-alpha.*`、`0.1.x` 等宿主版本做运行验证，`dshReleases` 中未声明的版本保持 `unknown`。
- 桌面 profile 的安装由 Electron 管理，证据来自真实运行实例，但不是一次性 Profile 的自动化夹具。
- 商城的源码静态扫描结论以商城固定 Commit 为准；本仓库只提供上述可复现证据。
