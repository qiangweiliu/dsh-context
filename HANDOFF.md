# 交接说明 · agent-embodiment 0.25.0（2026-11-10）

给接手的人：这份文件只记录**当前状态、已完成、待办和命令**；设计细节见 `agent-embodiment/docs/`。

## 0. 一句话状态

0.25.0 的「真实缺陷修复 + 工程化」已完成并全部测试通过（单元 375 + 集成 139，lint 0 warning）；**未推送、未发布 npm、Desktop 0.2.2-rc.1 端到端仍未验收**。本轮最重要的一条：0.24.x 的面板有一个 TDZ 崩溃（四个 tab 全空），已修并补了行为级回归测试。

| 项 | 值 |
| --- | --- |
| 分支 / HEAD | `main` / 本轮提交（`git log -3 --oneline`） |
| 远端 | `origin/main = 9e09966`（0.24.1 那轮已推送）；本轮提交待推送 |
| 插件版本 | `agent-embodiment@0.25.0`（package/client/README/IMPLEMENTATION 已同步） |
| 兼容矩阵 | `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = **unknown** |
| 本机 DSH | Desktop 0.2.2-rc.1（`E:\tool\dsh\resources\app.asar`，Cordis 4.1.0）；WSL `dsh 0.2.1-rc.5` |
| npm | **未发布**（本会话浏览器登录未完成，`npm whoami` 仍 ENEEDAUTH） |
| 状态目录 | 0.25.0 起按 profile 分层：`~/.dsh/agent-embodiment/profiles/<profile>/` |

## 1. 本轮（0.25.0）做了什么

### 1.1 真实缺陷（P1）

| 问题 | 修复 | 证据 |
| --- | --- | --- |
| **面板整块崩溃**：`CtxPanel` 里 `analyticsLimit` 读 `budget` 早于 `const budget` 声明（TDZ），每次渲染抛 `ReferenceError`，四个 tab 全空 | 把 `data` / `budget` 提到使用点之前；新增 `test/render.mjs` 真跑组件 | `render 23/23` |
| 控制行 `maxContextTokens` 永不生效（宿主默认值遮蔽） | `state.setControlBudget` + 新优先级：会话覆盖 > 控制行(>0) > 宿主 > 100000 | `state 26/26`、`control 55/55` |
| 有 `webServer` 无 `connection` 时 23 条路由裸奔 | 该形态一律 403；纯 headless 仍放行 | `smoke 73/73` |
| 状态目录跨 profile 共享 | `profile.js` 识别 profile 并分层，旧文件自动复制迁移 | `profile 11/11` |
| CSV 无 BOM，Excel 中文乱码 | `metrics.csvDocument()` 加 `\uFEFF` | `metrics 45/45` |
| 价格表过期无提示 | `insights` 新增 `pricing-stale`（>30 天） | `insights 16/16` |
| 兼容声明自相矛盾（宽范围 vs unknown） | 状态接口下发 `compatibility`，文档写清“范围 ≠ 验证” | 文档 + smoke |

### 1.2 工程化（P2）

- `client.js`：卡片级 `ErrorBoundary`（降级卡 + 重试，正常路径不加 DOM）+ tab 可访问性（`role=tablist/tab/tabpanel`、`aria-*`、roving tabindex、←/→/Home/End）。
- `oxlint`（`.oxlintrc.json` + `npm run lint`，CI 跑，0 error / 0 warning）；`package-lock.json` + `npm ci`；CI 加 npm 缓存、`concurrency`、lint、`timeout-minutes`。
- `scripts/bench-analytics.mjs`：40×200 P50 6.6ms / P95 12.4ms；200×400 P50 18.7ms / P95 62.4ms（已写入 LIMITATIONS）。
- `scripts/wsl-verify.sh` 默认 **dry-run**，`--apply` 才安装/启动。
- 文档漂移修正：IMPLEMENTATION 的测试清单与计数、CORE-FUNCTION-AUDIT 的 P2-1/P2-3 状态。

## 2. 已验证

- 单元 375 项：static 101 / metrics 45 / state 26 / persist 7 / profile 11 / scaffold 146 / insights 16 / render 23。
- 集成 139 项：control 55 / smoke 73 / prompt-state 11（Cordis 4.1.0，来自本机 asar）。
- `npm run lint`：0 error / 0 warning。
- `npm pack --dry-run`：22 个文件、178.7 kB（unpacked 600.8 kB）。
- 未验证：Desktop/WSL 上安装 0.25.0 后的面板点击（本轮只有行为级 mock 渲染）、0.2.2-rc.1 端到端。

## 3. 待办（按顺序）

### 3.1 推送本轮提交

```powershell
cd C:\Users\40410\Desktop\context
git push origin main
```

推后看 CI（`.github/workflows/test.yml`）：unit 20/22/24 + lint + integration 两档，应全绿。

### 3.2 Desktop 端到端（0.2.2-rc.1，仍为 unknown）

当前 Desktop profile 是 `agent-embodiment: link:C:/Users/40410/dsh-plugins/agent-embodiment`，那份副本还是 **0.23.0**。要验 0.25.0：

```powershell
$dst = "C:\Users\40410\dsh-plugins\agent-embodiment"
Copy-Item $dst "$dst.bak-$(Get-Date -f yyyyMMdd-HHmmss)" -Recurse
robocopy "C:\Users\40410\Desktop\context\agent-embodiment" $dst /MIR /XD test/deps node_modules /NFL /NDL /NJH /NJS
```

同步后 HMR 生效，按 [RELEASE-PLAN §10](agent-embodiment/docs/RELEASE-PLAN.md#L290) 第 1–4 项点一遍（4 tab / 引导三出口 / 一次真实压缩 / CSV 导出）。**本轮 TDZ 崩溃说明“面板能出现”必须亲眼确认**。通过后 `0.2.2-rc.1` 改 `compatible` 并补 E34。

### 3.3 npm 发布

仍未发布（本会话浏览器登录未完成）。需要登录 + 2FA 后 `npm publish --access public`，再打 tag `v0.25.0`。

### 3.4 0.26.0 候选

- `client.js` 拆模块（4054 行；本轮只加了错误边界兜底与行为测试）。
- `engines.dsh` 收窄为显式枚举（需先完成 Desktop 验收）。
- 全局工具禁用两层实现统一（CORE-FUNCTION-AUDIT P2-2）。
- analytics 真实宿主性能采样（当前只有纯函数基线）。

## 4. 回滚

- 代码：`git revert <本轮提交>`；或 `git reset --hard 9e09966` 回到 0.24.1。
- 状态目录：0.25.0 若误判 profile，会把状态写到 `profiles/<name>/`；旧共享目录数据未被删除，删掉新目录即可回到旧行为。
- 插件（WSL web）：`dsh plugin --profile web add /home/wu/dsh-context/agent-embodiment`（0.23.0）或 `~/dsh-plugins/agent-embodiment`（0.24.1）。
- profile 残留：`node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>`。

## 5. 明确未做

- `client.js` 模块拆分、更新提示胶囊、全量可访问性复核（只做了 tab 语义与键盘）。
- Desktop 0.2.2-rc.1 端到端、WSL 面板截图。
- npm 发布与 tag。
