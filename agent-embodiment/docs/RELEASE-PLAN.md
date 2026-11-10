# agent-embodiment 版本升级计划

本文是插件的版本路线图与发布门禁。目标：**每个版本只承诺有证据的能力**，并让升级过程可回滚、可复现。

- 当前工作区版本：`0.24.1`（尚未发布；0.24.0 + 安全/可靠性修复）
- 上一发布版本：`0.21.0`（`0.22.0` / `0.23.0` / `0.24.0` / `0.24.1` 均未单独发布，目标是一次性发布 0.24.1）
- 日期：2026-11-10
- 相关文档：[README](../README.md)、[IMPLEMENTATION](IMPLEMENTATION.md)、[LIMITATIONS](LIMITATIONS.md)、[EVIDENCE](EVIDENCE.md)、[Tier B 结果](../../eval/deep/RESULTS.md)

> 时间均为目标窗口，不是承诺；版本能否发布只看门禁是否通过。

---

## 0. 0.22.0 包含什么

0.22.0 是“定位调整 + 安全/成本治理”版本，不新增模型能力：

- 路由统一经过 `ctx.connection.requestRejection`；POST 只接受 `application/json`；scaffold `targetDir` 拒绝系统目录/凭据目录。
- 底部 token 指示器只显示“插件上下文上限”，不再重复官方 ContextMeter。
- 移除生成的 `sense_environment` 工具与 `tool-catalog` skill。
- 脚手架 process skills 改为 opt-in（`processSkills` / `--process-skills` / 面板 checkbox）；默认只生成角色与 delegation skill。
- 4 个未验证模板标记 `experimental`。
- 成本估算支持 `modelPricing` 用户价格表。
- `autoMountControl` 写入后回读校验。
- 版本号同步到 `0.22.0`。

Tier B 证据（50 题）：

- base 47/50；3 道长上下文题稳定失败，四组都失败。
- compact 单次全量曾显示 input −28%，但全量 3 reps 未复现（−363，95% CI 跨 0；McNemar p=0.200），不能作为卖点。
- 旧 scaffold（含 process skills）工具调用 46.5、7/10；0.22.0 默认 scaffold 工具调用 4.7、10/10。
- plugin 仅宿主半侧；补跑后无准确率差异。

---

## 1. 版本策略

### 1.1 SemVer 口径

| 类型 | 允许 | 不允许 |
|---|---|---|
| patch（0.22.x） | bug fix、文档、测试、兼容性补丁 | 新功能、默认行为变化、移除配置 |
| minor（0.x.0） | 新功能、新的可选配置、默认值调整（需迁移说明） | 移除已发布配置/命令 |
| major（1.0.0） | 移除兼容别名、冻结/重构 API、默认行为大改 | 无证据的能力承诺 |

### 1.2 DSH 兼容矩阵

- 当前声明：`>=0.2.0-rc.2 <0.3.0 || 0.2.1-rc.2 || 0.2.1-rc.3`
- 已实测：`0.2.0-rc.2`（WSL web）、`0.2.1-rc.2`（Desktop）、`0.2.1-rc.5`（WSL web，2026-11-10：`scripts/wsl-verify.sh` 真实安装 + 启动 + 状态接口 0.24.1 / `control.active=true`）。
- `0.2.1-rc.3`（npm `next`）已完成 headless + Web 实测并加入矩阵；Desktop 未验收。
- `0.2.2-rc.1`：集成 137 项在 Cordis 4.1.0 下通过，但 Desktop 端到端验收未做，保持 `unknown`。
- **规则**：未跑通 smoke/control/prompt-state + 一次真实安装之前，不把版本写进 `dshReleases`。

---

## 2. 路线图

| 版本 | 类型 | 状态 | 主题 | 关键交付 |
|---|---|---|---|---|
| `0.22.0` | 安全 + 定位调整 | 已并入工作区 | 安全加固 | 路由认证、scaffold 路径保护、process skills opt-in、4 个模板标 experimental |
| `0.23.0` | 证据与压缩控制 | 已并入工作区 | 压缩可控 | 3 reps 对照、三档 preset、控制未挂载提示、analytics 限额、rc.3 兼容、费用估算 |
| `0.24.0` | 产品补齐 | 已并入 0.24.1 | 可解释与可信任 | 首次运行引导、洞察/健康检查、节省估算、数据导出与清理、4 tab IA、会话对比、自定义价格 |
| `0.24.1` | patch | **当前工作区版本** | 安全与可靠性 | CSV 公式注入、状态原子写 + 备份回落、读取超时 AbortSignal、PERMISSIONS 对齐、CI 集成、版本 bump 脚本 |
| `1.0.0` | major | 2026-12 起，按门禁 | 稳定承诺 | 移除 `/ctx` 别名与旧状态迁移、冻结配置面、安全审查、兼容矩阵 |

---

## 3. 各版本范围

### 3.1 0.22.0（历史基线，已并入当前工作区）

**范围冻结**：只做发布，不再加功能。

发布门禁：

```bash
cd agent-embodiment
npm test
npm run test:integration
npm pack --dry-run
```

- 单元：static / metrics / state / scaffold 全绿（当时 77/24/16/146；当前基线见 [IMPLEMENTATION](IMPLEMENTATION.md)）。
- 集成：control / smoke / prompt-state 全绿（当时 54/66/11）。
- 包内容：`npm pack --dry-run` 无缺文件（当前 20 个文件）。
- Tier B 子集：scaffold 默认 10 题（当前 10/10，工具调用 4.7）已记录。
- 文档/版本同步：`package.json`、`client.js` 的 `CLIENT_VERSION`、README、IMPLEMENTATION、EVIDENCE、市场申请文件。
- 市场文案：不再承诺“更准/更强”；scaffold 标注 optional/experimental。
- 发布：`npm publish` + 打 tag `v0.22.0` + 向 `awesome-dsh-plugin` 提 PR。
- 回滚：`dsh plugin add agent-embodiment@0.21.0`，再用 `scripts/clean-agent-embodiment-profile-patch.mjs` 清 preset 残留。

### 3.2 0.22.1（patch）

只修 0.22.0 发布后的问题：

- 安装/热加载/版本不一致提示的 bug。
- Tier B runner / compare 脚本的 bug（不影响插件运行时）。
- 文档错漏、测试计数同步。
- 不新增配置项，不改默认值。

**不包含**：scaffold 功能改动、压缩策略调整、兼容矩阵扩容。

### 3.3 0.23.0（minor，“证据与压缩控制”，已实现）

1. **3 reps 正式对照**：base vs compact，50 题 × 3 次；逐题配对统计，输出 `eval/deep/RESULTS-3REP.md`。
2. **压缩策略 preset**：把 `maxContextTokens` / `keepTokens` / `targetAt` 组合成 2-3 个有名字的策略（conservative / balanced / aggressive），在面板/配置中可选，并写清每档的 token/召回取舍。
3. **scaffold 全量复核**：默认 scaffold 跑完整 50 题；决定是否保留 `repo-coder`、是否给长表任务增加一个 opt-in 的“写文件 + 脚本计算”skill。
4. **控制未挂载 UI**：`control.active === false` 时禁用提示词/工具开关并给出原因；`presetMounted` 变化时提示重新同步。
5. **analytics 限额**：`limit` 从固定 40 改为可配置（默认 40，最大 200），并在返回里带覆盖范围；成本价格覆盖补测。
6. **rc.3 兼容**：在隔离 profile 安装 `0.2.1-rc.3`，跑 smoke/control/prompt-state + Tier B 子集；通过后加入 `dshReleases`。
7. **client 行为测试**：补 dock 标签、设置写回、空状态、控制未挂载禁用的测试。

发布门禁：3 reps 结果 + rc.3 证据 + 全量测试 + 无准确率承诺。

### 3.4 0.24.0（minor，“产品补齐”，已实现）

原计划是“分发与 UX”（市场验收、提示词/工具控制 UX、client 拆模块）。实际执行时按产品复盘重排了优先级：先补“用户能不能看懂、能不能信任、能不能行动”，分发验收留到发布前单独做。

已交付：

1. **首次运行引导**：`onboarding.json` + 三步引导（预算校准 / 压缩策略 / 控制行挂载授权），可跳过，设置里可改；授权不等于已挂载。
2. **控制行默认不自动挂载**：`autoMountControl` 改默认 `false`；`/status/config/preset` 记录同意并回读校验。
3. **洞察与健康检查**：新增 `insights.js`（6 条规则）和 `/status/insights`；每条洞察带跳转动作。
4. **节省估算**：跨会话汇总成功压缩的前后差值，按 V4.1 Flash 输入价折算，明确标注不是账单退款。
5. **数据边界可见**：`coverage { total, scanned, withData, limit }`、`GET /status/export`、`POST /status/data/reset`。
6. **信息架构**：侧栏改名 `Context` / `上下文`；4 个 tab（Overview / Trend / Events / Settings）；脚手架下沉到 Settings → Labs。
7. **对比与费用**：会话对比、会话详情费用拆分、自定义 `modelPricing` 编辑、告警提示条。
8. **默认值**：`triggerAt` 0.9、`targetAt` 0.6、`balanced` = 0.9 / 0.6 / keep 25%。

本轮执行记录（2026-10-25）：

- 单元：static 95/95、metrics 35/35、state 18/18、scaffold 146/146、insights 12/12。
- 集成：control 54/54、smoke 72/72、prompt-state 11/11。
- 语法：`node --check index.js control.js client.js` 通过。
- 包：`npm pack --dry-run` 20 个文件、约 163 kB、退出码 0。

**未包含**（明确延后）：

- 团队/云端汇总分析、AI 自动建议、更多图表模板、DeepSeek 以外的价格表。
- `client.js` 拆成独立可测试模块、脚手架生成器拆包。
- `extraPrompts` 改用官方 `agent.inject()`：行为差异需要单独验证，不在本版改动。

发布门禁沿用第 4 节；本轮在门禁之外**没有**重做 Desktop/Web 端到端点击，发布前需补一次 E22 式验收。

### 3.5 1.0.0（major，按门禁）

进入 1.0.0 的条件（全部满足）：

- `0.23.0` / `0.24.0` 的 3 reps 证据稳定，且没有未解释的准确率回退。
- DSH 兼容矩阵至少覆盖 2 个稳定版本，并有一次完整安装/升级验收。
- 独立安全审查完成；PERMISSIONS 与实际访问面一致。
- `client.js` 关键路径有行为测试；analytics 有性能基线。
- 文档、CHANGELOG、迁移指南完整。

1.0.0 范围：

- 移除 `/ctx`、`/ctx-compact` 别名和 `ctx-mon-and-con` 状态迁移。
- 冻结 `Config` 字段与路由；后续变更走 minor + 迁移说明。
- 明确“插件是上下文可观测性/控制层，不是模型能力增强器”的长期定位。

---

## 4. 每版发布门禁（Checklist）

### 4.1 代码与测试

```bash
cd agent-embodiment
node --check index.js && node --check control.js && node --check client.js
npm test
npm run test:integration
npm pack --dry-run
```

- 单元 + 集成全绿。
- `static` 的版本断言通过（`client.js` 与 `package.json` 一致）。
- 新增/修改的脚本先跑 `node --check`。

### 4.2 兼容与安装

- 在隔离 `DSH_HOME` 安装当前包，确认 `--dump-config` 出现 `agent-embodiment`。
- Web：面板、Agent tab、控制状态、余额胶囊各打开一次。
- Desktop：至少一次安装/启停；注意升级包需要重启进程。
- `0.2.1-rc.3` 只在实测通过后写入矩阵。

### 4.3 证据

- Tier B 结果写入 `eval/deep/RESULTS*.md`，原始 JSONL 入库。
- 不在没有 3 reps 的情况下写“准确率提升/下降”结论。
- 新功能要么有测试，要么标 experimental。

### 4.4 版本同步

- `agent-embodiment/package.json` 的 `version`
- `agent-embodiment/client.js` 的 `CLIENT_VERSION`
- 根 `README.md`、`agent-embodiment/README.md`
- `docs/IMPLEMENTATION.md`、`docs/EVIDENCE.md`
- `submission/qiangweiliu__dsh-context--agent-embodiment.yml`（描述变化时）
- `agent-embodiment/CHANGELOG.md`（0.22.0 起新增）

### 4.5 回滚

- 回滚命令：`dsh plugin --profile <profile> add agent-embodiment@<上一版本>`
- 清理 preset 残留：`node scripts/clean-agent-embodiment-profile-patch.mjs ~/.dsh/profiles/<profile>`
- 升级包替换后仍需要重启 DSH；回滚同样适用。

---

## 5. 测试矩阵

| 层级 | 内容 | 频率 |
|---|---|---|
| 单元 | static / metrics / state / scaffold / insights | 每次提交 |
| 集成 | control / smoke / prompt-state | 每次发布 |
| Tier B | 50 题 × 条件 × reps | 每个 minor |
| UI | WSL web + Desktop 安装/面板/设置 | 每个 minor |
| 兼容 | rc.2 / rc.3（通过后） | 每个 DSH 新版本 |

Tier B 命令：

```bash
node eval/deep/setup-conditions.mjs
node eval/deep/run.mjs --condition base --reps 3 --workers 2 --out eval/results/deep-b-base.jsonl
node eval/deep/run.mjs --condition compact --reps 3 --workers 2 --out eval/results/deep-b-compact.jsonl
node eval/deep/compare.mjs --markdown
```

---

## 6. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| DSH 升级改动 preset/compaction | 控制行静默失效 | auto-mount 回读校验；升级后跑 control/smoke；文档写清手工同步 |
| 压缩策略伤召回 | 长会话答案变差 | 3 reps + 逐题配对；提供 conservative/balanced 策略；不默认激进 |
| Scaffold 成本 | 工具调用/输出膨胀 | process skills 默认关闭；只保留角色 skill；全量复核后再决定 |
| 版本兼容误报 | 安装被 semver 拒绝或运行失败 | 只在实测后写入 `dshReleases`；保留回滚 |
| client.js 单文件过大 | UI 回归难定位 | 0.23.0 起补行为测试；拆模块已延后到 1.0.0 前（0.24.0 未改，避免回归面扩大） |
| 市场文案过度承诺 | 审核/口碑风险 | 只写 token/控制/可观测性；不写“更准” |

---

## 7. 执行记录（2026-10-24）

| 项目 | 状态 | 结果 |
|---|---|---|
| 0.22.0 发布门禁 | ✅ 完成 | 单元 + 集成 + `npm pack` 全绿；18 个文件 |
| CHANGELOG | ✅ 完成 | `agent-embodiment/CHANGELOG.md` 回填 0.22.0 / 0.21.0 |
| 3 reps 子集 | ✅ 完成 | base 19/24（79.2%，input 23,715）；compact 20/24（83.3%，input 20,525）；long-05 两组 0/3 |
| DSH rc.3 | ✅ Web/headless | headless 安装、插件加载、Cordis 测试全绿；Web 状态接口返回 v0.23.0、control active/mounted、UI 出现 embody；`dshReleases` 已加入；Desktop 未验收 |
| 市场条目 | ✅ PR 已创建 | [PR #9029](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9029)；CI 全绿、mergeable；等待维护者合并后 catalog 更新 |
| npm 发布 | ⏸ 暂停 | npm 已登录为 `namegame`；发布需要 2FA OTP 或 bypass token，按用户要求暂停 |
| 市场 PR 创建 | ✅ 完成 | PR #9029；Submission gate + check 均为 success |
| 本地市场镜像 | ⏸ 已停止 | `scripts/local-market-mirror.mjs` 可随时重启；按用户要求暂停市场提交后停止 |

market PR compare URL：

```text
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare/main...qiangweiliu:update-agent-embodiment?expand=1
```

## 8. 0.23.0 执行记录（2026-10-24）

| 项目 | 状态 | 结果 |
|---|---|---|
| `compressionStrategy` preset | ✅ | conservative / balanced / aggressive；显式 trigger/target/keep 优先；配置校验 + 设置页下拉 |
| 控制未挂载 UI | ✅ | `control.active === false` 时提示并拒绝工具/提示词修改；静态测试覆盖 |
| `analyticsLimit` | ✅ | 1..200，默认 40；`?limit=` 临时覆盖 |
| 测试 | ✅ | static 79 / metrics 24 / state 16 / scaffold 146 / control 54 / smoke 69 / prompt-state 11 |
| 版本 | ✅ | `0.23.0`（package/client/README/IMPLEMENTATION/EVIDENCE/CHANGELOG 同步） |
| scaffold 默认全量 50 题 | ✅ | 默认 46/50、tools 5.1、output 3,836、input 18,817、72s；base 47/50、5.5、4,332、22,317、79s；准确率无提升，成本接近 base |
| 全量 3 reps base vs compact | ✅ | base 121/150（80.7%）、compact 129/150（86.0%）；McNemar p=0.200；input −363（CI 跨 0）；无显著差异 |
| rc.3 Web/Desktop | 🟡 Web ✅ / Desktop ⬜ | headless + Cordis + Web 已通过；Desktop Electron 未测 |

## 9. 0.24.0 执行记录（2026-10-25）

| 项目 | 状态 | 结果 |
|---|---|---|
| 源码恢复 | ✅ | `client.js` 被命令行文本改写写坏后，按会话日志的 183 次 `edit` 重放 59 次未提交改动恢复；`node --check client.js` 通过 |
| 首次运行引导 | ✅ | `onboarding.json` + `GET/POST status/onboarding`；三步引导可跳过，设置里可改 |
| 控制行默认值 | ✅ | `autoMountControl` 默认 `false`；授权 ≠ 已挂载，回读 `control.active` |
| 洞察与健康检查 | ✅ | `insights.js`（6 条规则）+ `GET status/insights`；`buildHealth` 覆盖 control/preset/config/budget/measurement |
| 节省估算 | ✅ | `savings { compactions, tokens, estimatedCost, currency, method }`；= 成功压缩前后差值 × V4.1 Flash 输入价，非退款 |
| 数据导出/清理 | ✅ | `GET status/export`（JSON / CSV）、`POST status/data/reset`（`logs` / `toggles` / `all`） |
| 信息架构 | ✅ | 侧栏 `Context` / `上下文`；Overview / Trend / Events / Settings；脚手架移到 Settings → Labs |
| 默认值 | ✅ | `triggerAt 0.9`、`targetAt 0.6`、`balanced = 0.9/0.6/keep 25%` |
| 测试 | ✅ | static 95 / metrics 35 / state 18 / scaffold 146 / insights 12 / control 54 / smoke 72 / prompt-state 11 |
| 打包 | ✅ | `npm pack --dry-run` 20 个文件、约 163 kB、退出码 0 |
| Desktop/Web 端到端 | ⬜ 未做 | 本轮只有源码/静态/集成验证，发布前需补一次真实安装与面板验收 |

## 10. 发布 0.24.0 前的待办

1. 在隔离 `DSH_HOME` 与 Desktop 各做一次安装，确认面板 4 个 tab、`Context` 命名、Settings → Labs、首次引导都出现。
2. 走一遍首次运行引导的三种出口（确认预算 / 跳过 / 授予挂载），确认 `onboarding.json` 与 `control.active` 一致。
3. 触发一次真实压缩，确认事件页、节省卡、洞察卡读的是同一份日志。
4. 用 `GET status/export` 拉一次 CSV，核对列与 `metrics.js` 口径一致。
5. 跑完整发布门禁（第 4 节），再 `npm publish` + tag `v0.24.0`。
6. 市场 PR 描述同步到 0.24.0：写清 analytics 范围、节省是估算、scaffold 仍是 optional/experimental。
