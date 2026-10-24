# 验收证据（agent-embodiment）

- 仓库：<https://github.com/qiangweiliu/dsh-context>（插件目录 `agent-embodiment/`）
- 版本：`0.23.0`（本文件随 manifest 兼容性声明一起提交）
- 采集日期：2026-10-18
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

## 已知限制（unknown）

- 未进行独立安全审计；本文件不声称“安全通过”。
- 未对 `0.2.0-rc.1`、`0.2.1-alpha.*`、`0.1.x` 等宿主版本做运行验证，`dshReleases` 中未声明的版本保持 `unknown`。
- 桌面 profile 的安装由 Electron 管理，证据来自真实运行实例，但不是一次性 Profile 的自动化夹具。
- 商城的源码静态扫描结论以商城固定 Commit 为准；本仓库只提供上述可复现证据。
