# 交接说明 · agent-embodiment 0.24.1（2026-11-10）

给接手的人：这份文件只记录**当前状态、已完成、待办和命令**；设计细节见 `agent-embodiment/docs/`。

## 0. 一句话状态

0.24.1 的安全/可靠性修复已完成并提交在本地 `main`，**未推送、未发布 npm、WSL 端到端验收未跑**。代码测试全绿；剩下的都是需要 Windows/WSL 凭据或人工点击的步骤。

| 项 | 值 |
| --- | --- |
| 分支 / HEAD | `main` / 最新提交（含本文件；`git log -1 --oneline` 查看） |
| 远端 | `origin/main = a958590`，本地领先 3 个提交：`01af6e0` 0.24.0、`a0ab1b0` 0.24.1、本交接文件 |
| 插件版本 | `agent-embodiment@0.24.1`（package.json / client.js / README / IMPLEMENTATION 已同步） |
| 兼容矩阵 | `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` = compatible；`0.2.2-rc.1` = **unknown** |
| 本机 DSH | Desktop 运行时 0.2.2-rc.1（`E:\tool\dsh\resources\app.asar`，cordis 4.1.0 / cosmokit 1.9.0） |
| npm | **未发布**（registry 404）；市场 PR #9029 已于 2026-10-24 合并 |

## 1. 本次改了什么

| 文件 | 改动 |
| --- | --- |
| `agent-embodiment/metrics.js` | 新增 `csvCell`：RFC 4180 引号 + 公式注入中和（`=`/`+`/`-`/`@`/TAB/CR 开头加 `'`，数字不变） |
| `agent-embodiment/persist.js`（新） | `atomicWriteFile` / `backupFile` / `latestBackupJson`；备份同毫秒去重、保留 30 份、按 mtime 取最新 |
| `agent-embodiment/index.js` | 导出改用 `csvCell`；session-toggles / onboarding / 压缩日志改原子写；读坏回落最近备份；`observeSession`/`listSessions` 超时改 `AbortSignal` 取消 |
| `agent-embodiment/test/persist.mjs`（新） | 原子覆盖、无临时残留、备份轮转、损坏回落 |
| `agent-embodiment/test/metrics.mjs` | CSV 相关 7 条断言 |
| `agent-embodiment/test/static.mjs` | `files` 增加 `persist.js`；新增 3 条版本号副本一致断言 |
| `agent-embodiment/PERMISSIONS.md` | 与实现对齐：会话事件派生字段、导出字段、CSV 处理、`process.env` 表述、矩阵补 rc.3 |
| `agent-embodiment/README.md` | 新增安装 / 升级 / 回滚章节（npm 发布前用源码路径） |
| `agent-embodiment/screenshots.json`（新） | 市场详情页截图（仓库内相对路径 5 张） |
| `agent-embodiment/package.json` | 0.24.1；`files` 加 `persist.js`；`dshReleases` 加 `0.2.2-rc.1: unknown` |
| `.github/workflows/test.yml` | 新增 integration job：npm 装 Cordis 4.0.5 / 4.1.0 两档跑 control/smoke/prompt-state |
| `scripts/bump-version.mjs`（新） | 一次同步 package/client/README/IMPLEMENTATION 版本号 |
| `scripts/wsl-verify.sh`（新） | WSL 一键验证：同步 → 测试 → 装 profile → 起 web → 校验状态接口 |
| 文档 | CHANGELOG 0.24.1、LIMITATIONS、RELEASE-PLAN、CLAUDE.md（测试基线/命令/架构）、`docs/security-audit.md` 增量复核 |

## 2. 已验证（沙盒）

- 单元 323 项全绿：static 98、metrics 42、state 18、persist 7、scaffold 146、insights 12。
- 集成 137 项全绿：control 54、smoke 72、prompt-state 11；分别在 Cordis **4.0.5**（cosmokit 1.8.6）和 **4.1.0**（1.9.0）下跑过。
- `node --check index.js control.js client.js persist.js` 通过。
- `npm pack --dry-run`：21 个文件、约 573 kB、退出码 0。
- 未验证：WSL/Desktop 真实安装与 UI 点击；0.2.2-rc.1 端到端。

## 3. 待办（按顺序）

### 3.1 WSL 端到端验收（需要你在 Windows 执行）

```powershell
wsl.exe -d Ubuntu-24.04 -e bash /mnt/c/Users/40410/Desktop/context/scripts/wsl-verify.sh web
```

- 脚本会：同步源码到 `~/dsh-plugins/agent-embodiment` → `node --check` + 单元 + 集成 → 从 `web` profile 移除旧版并安装本地 0.24.1 → 启动 `dsh --profile web`（**会先停掉现有的同 profile 实例**）→ 用 token 取 cookie 请求 `/api/agent-embodiment/status` 校验版本与 `control.active` → 停掉实例。
- 不想动正在跑的 DSH：加 `SKIP_START=1`，只做同步、测试和安装。
- 日志：`/tmp/embody-unit.log`、`/tmp/embody-int.log`、`/tmp/embody-install.log`、`/tmp/embody-web.log`；最后一行 `RESULT=PASS/FAIL`。
- **通过后**：把 `agent-embodiment/package.json` 里 `0.2.2-rc.1` 从 `unknown` 改为 `compatible`，同步 PERMISSIONS/LIMITATIONS；再跑一次 `npm test` 与 bump 检查。

### 3.2 推送

```powershell
cd C:\Users\40410\Desktop\context
git push origin main
```

沙盒没有 GitHub 凭据，两个提交仍在本地；推送后用 `git ls-remote origin main` 核对是否为 `a0ab1b0`。

### 3.3 npm 发布

- `npm publish` 需要账号 2FA（上次因 OTP 暂停）。发布前确认包名 `agent-embodiment` 仍可用。
- 发布后 README 里的「从 npm 安装」才成立；市场条目无需 PR（npm 映射自动采集）。
- 市场条目如需更新描述，走 `submission/qiangweiliu__dsh-context--agent-embodiment.yml` 的单独 PR（只改自己条目）。

### 3.4 发布前验收（RELEASE-PLAN §10）

- Desktop 与 WSL 各一次安装：4 个 tab、`Context` 命名、Settings → Labs、首次引导三种出口。
- 真实压缩一次：事件页、节省卡、洞察卡读同一份日志。
- `GET /status/export` 拉 CSV，核对列与 `metrics.js` 口径。

## 4. 回滚

- 代码：`git revert a0ab1b0`（或 `git reset --hard 01af6e0` 丢弃 0.24.1；交接文件提交单独保留/丢弃均可）。
- 插件：`dsh plugin --profile web add agent-embodiment@<上一版本>`；源码安装则重新 `add` 旧路径。
- profile 残留：`node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>`。
- 状态文件损坏：0.24.1 起会自动回落 `~/.dsh/agent-embodiment/backups/` 的最新备份。

## 5. 明确未做（0.25.0 范围）

- `client.js`（4000+ 行）拆模块与卡片级 ErrorBoundary。
- 更新提示胶囊（npm registry / 市场数据）。
- analytics 性能基线（40 会话整日志折叠的 P50/P95 与内存）。
- 可访问性（tab 语义、键盘导航）。
- 已知设计债：control 行 `maxContextTokens` 被宿主默认值遮蔽、全局工具禁用两层实现、状态目录跨 profile 共享（见 CORE-FUNCTION-AUDIT）。
- `engines.dsh` 仍是宽区间，会自动放行未测的 0.2.x 预发布；0.2.2 验收后建议收窄为显式枚举。
