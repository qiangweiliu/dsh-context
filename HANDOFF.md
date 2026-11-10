# 交接说明 · agent-embodiment 0.24.1（2026-11-10 22:45 更新）

给接手的人：这份文件只记录**当前状态、已完成、待办和命令**；设计细节见 `agent-embodiment/docs/`。

## 0. 一句话状态

代码与 **WSL 端到端验收都已完成**；剩下三项都需要人工或凭据：**Desktop 端到端验收、推送、npm 发布**。WSL 已不再是阻塞项。

| 项 | 值 |
| --- | --- |
| 分支 / HEAD | `main` / `724ae7d`（已推送；本文件后续若有提交会再更新） |
| 远端 | `origin/main` 已与本地同步（2026-11-10 22:27 推送 `a958590..724ae7d`）；CI run #20 五个 job 全绿：unit 20/22/24 + integration（Cordis 4.0.5+cosmokit 1.8.6、4.1.0+1.9.0） |
| 插件版本 | `agent-embodiment@0.24.1` |
| 兼容矩阵 | `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = **unknown** |
| 本机 DSH | Desktop 运行时 0.2.2-rc.1（`E:\tool\dsh\resources\app.asar`，Cordis 4.1.0）；WSL `dsh 0.2.1-rc.5` |
| npm | **未发布**（registry 404，`npm whoami` = ENEEDAUTH） |
| WSL web profile | 已 `link:/home/wu/dsh-plugins/agent-embodiment`（0.24.1），原链是 `~/dsh-context`（0.23.0） |

## 1. 2026-11-10 第二轮（交接之后）做了什么

| 文件 | 改动 |
| --- | --- |
| `scripts/wsl-verify.sh` | 修 3 处首跑暴露的缺陷：`set -u` 下 `$LOCALAPPDATA` 未绑定导致中途退出（改 `DSH_ASAR` 优先 + `/mnt/c/Users/*/...` 通配）；单元套件改在仓库检出目录跑（独立副本缺 `../../README.md`）；安装后打印实际链接目标与回滚命令 |
| `agent-embodiment/package.json` | `dshReleases` 增加 `0.2.1-rc.5: compatible` |
| `agent-embodiment/PERMISSIONS.md` / `docs/LIMITATIONS.md` / `docs/RELEASE-PLAN.md` | 兼容矩阵同步 `0.2.1-rc.5`；`0.2.2-rc.1` 保持 `unknown` 并写明原因（Desktop 端到端未做） |
| `agent-embodiment/docs/EVIDENCE.md` | 新增 **E32**：WSL 真实安装 + 启动 + 状态接口验收、脚本缺陷修复记录、边界声明 |
| `agent-embodiment/CHANGELOG.md` | 0.24.1 的 Changed 补矩阵与脚本修复两条 |
| `CLAUDE.md` | 易错点补充「单元套件依赖仓库布局，不能只在安装副本里跑」 |

## 2. 已验证

- 单元 323 项全绿（static 98 / metrics 42 / state 18 / persist 7 / scaffold 146 / insights 12）：Windows 工作区与 WSL 源码目录各跑一遍。
- 集成 137 项全绿（control 54 / smoke 72 / prompt-state 11）：Windows 上按 CI 的 `test/deps/dsh/node_modules` 布局，用 npm 公开包复现 **Cordis 4.0.5+cosmokit 1.8.6** 与 **4.1.0+1.9.0** 两条线；WSL 内用 `E:\tool\dsh\resources\app.asar` 解出的 Cordis 4.1.0 再跑一遍。
- **WSL 端到端**：`scripts/wsl-verify.sh web` → `RESULT=PASS`；`GET /api/agent-embodiment/status` 返回 `version:"0.24.1"`、`control.active=true`，随后停掉实例无残留。
- 语法：`node --check index.js control.js client.js persist.js` 通过。
- 打包：`npm pack --dry-run` 21 个文件、167.2 kB（unpacked 573.4 kB）、退出码 0。
- 未验证：Desktop 端到端（面板 4 tab、引导三出口、真实压缩、CSV 导出）；WSL 面板点击/截图。

## 3. 待办（按顺序）

### 3.1 Desktop 端到端验收（人工，先同步副本）

当前 Desktop profile 是 `agent-embodiment: link:C:/Users/40410/dsh-plugins/agent-embodiment`，**那份副本仍是 0.23.0**，所以现在点 UI 验收不到 0.24.x。先同步：

```powershell
# 先备份，再覆盖（源=工作区 agent-embodiment/）
$dst = "C:\Users\40410\dsh-plugins\agent-embodiment"
Copy-Item $dst "$dst.bak-$(Get-Date -f yyyyMMdd-HHmmss)" -Recurse
robocopy "C:\Users\40410\Desktop\context\agent-embodiment" $dst /MIR /XD test/deps /NFL /NDL /NJH /NJS
```

同步后 HMR 生效，按 [RELEASE-PLAN §10](agent-embodiment/docs/RELEASE-PLAN.md) 第 1–4 项点一遍：4 个 tab / `Context` 命名 / Settings → Labs、引导三种出口（确认预算 / 跳过 / 授予挂载）与 `onboarding.json` + `control.active` 一致、一次真实压缩（事件页 / 节省卡 / 洞察卡读同一份日志）、`GET status/export?format=csv` 列与 `metrics.js` 口径一致。

通过后：`0.2.2-rc.1` 从 `unknown` 改 `compatible`，同步 PERMISSIONS/LIMITATIONS/RELEASE-PLAN，补 E33（截图放 `docs/ui/`）。

### 3.2 推送（已完成）

已推送 `a958590..724ae7d`（2026-11-10 22:27），`git ls-remote origin main` 等于本地 HEAD。CI [run #20](https://github.com/qiangweiliu/dsh-context/actions/runs/42834151550) 五个 job 全绿，新增的 `integration` job 首次通过（Cordis 4.0.5/4.1.0 两档）。

之前沙盒里 `git ls-remote` 报 `schannel SEC_E_NO_CREDENTIALS` 是因为受限沙盒拿不到 Windows 凭据；放开文件策略后同一个 credential helper（`manager`）可直接鉴权，无需手工输入。

### 3.3 npm 发布

- `npm publish` 需要登录 + 2FA（沙盒 `npm whoami` 为 ENEEDAUTH）。发布前确认包名 `agent-embodiment` 仍可用（当前 registry 404）。
- 发布后 README 的「从 npm 安装」才成立；打 tag `v0.24.1`。
- 市场条目无需新 PR（npm 映射自动采集），仅当描述要改时动 `submission/qiangweiliu__dsh-context--agent-embodiment.yml`。

### 3.4 WSL 面板点击/截图（补 E32 边界）

接口层已验，UI 层未验。可用 `scripts/wsl-start-web.sh 3080` 起实例，再 `scripts/ui-probe.mjs` / `ui-screenshot.mjs` 走 CDP。

## 4. 回滚

- 代码：`git revert a0ab1b0`（0.24.1）或 `git reset --hard 01af6e0`；本次文档/脚本提交可单独 revert。
- 插件（WSL web）：`dsh plugin --profile web add /home/wu/dsh-context/agent-embodiment`（恢复 0.23.0 链接）；profile 清单备份在 `~/.dsh/profiles/web/package.json.bak-embody-20261110-222305`。
- 插件（Desktop）：把 `C:\Users\40410\dsh-plugins\agent-embodiment` 换回 0.23.0 副本，或 `dsh plugin --profile desktop add <旧路径>`。
- profile 残留：`node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>`。
- 状态文件损坏：0.24.1 起自动回落 `~/.dsh/agent-embodiment/backups/` 最新备份。

## 5. 明确未做（0.25.0 范围）

- `client.js`（4000+ 行）拆模块与卡片级 ErrorBoundary。
- 更新提示胶囊（npm registry / 市场数据）。
- analytics 性能基线（40 会话整日志折叠的 P50/P95 与内存）。
- 可访问性（tab 语义、键盘导航）。
- 已知设计债：control 行 `maxContextTokens` 被宿主默认值遮蔽、全局工具禁用两层实现、状态目录跨 profile 共享（见 CORE-FUNCTION-AUDIT）。
- `engines.dsh` 仍是宽区间，会自动放行未测的 0.2.x 预发布；Desktop（0.2.2-rc.1）验收后再收窄为显式枚举。
