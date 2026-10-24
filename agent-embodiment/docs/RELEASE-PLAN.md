# agent-embodiment 版本升级计划

本文是插件的版本路线图与发布门禁。目标：**每个版本只承诺有证据的能力**，并让升级过程可回滚、可复现。

- 当前工作区版本：`0.23.0`（尚未发布）
- 上一发布版本：`0.21.0`（`0.22.0` 未发布，直接进入 0.23.0）
- 日期：2026-10-24
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
- 已实测：`0.2.0-rc.2`（WSL web）、`0.2.1-rc.2`（Desktop）。
- `0.2.1-rc.3`（npm `next`）已完成 headless + Web 实测并加入矩阵；Desktop 未验收。
- **规则**：未跑通 smoke/control/prompt-state + 一次真实安装之前，不把版本写进 `dshReleases`。

---

## 2. 路线图

| 版本 | 类型 | 目标窗口 | 主题 | 关键交付 |
|---|---|---|---|---|
| `0.22.0` | 发布当前工作区 | 2026-10-24 ~ 10-28 | 安全 + 定位调整 | 发布门禁、CHANGELOG、市场 PR |
| `0.22.1` | patch | 2026-10-29 ~ 11-04 | 发布后修复 | 只修 0.22.0 暴露的问题；无 API 变化 |
| `0.23.0` | minor | 2026-11-05 ~ 11-20 | 证据与压缩控制 | 3 reps base vs compact、压缩策略 preset、scaffold 全量复核、rc.3 兼容 |
| `0.24.0` | minor | 2026-11-21 ~ 12-05 | 分发与 UX | 市场/Desktop 验收、控制未挂载 UI、analytics 限额、client 测试 |
| `1.0.0` | major | 2026-12-06 起，按门禁 | 稳定承诺 | 移除 `/ctx` 别名与旧状态迁移、冻结配置面、安全审查、兼容矩阵 |

---

## 3. 各版本范围

### 3.1 0.22.0（当前，先发布）

**范围冻结**：只做发布，不再加功能。

发布门禁：

```bash
cd agent-embodiment
npm test
npm run test:integration
npm pack --dry-run
```

- 单元：static / metrics / state / scaffold 全绿（当前 77/24/16/146）。
- 集成：control / smoke / prompt-state 全绿（当前 54/66/11）。
- 包内容：17 个文件，`npm pack --dry-run` 无缺文件。
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

### 3.3 0.23.0（minor，“证据与压缩控制”）

1. **3 reps 正式对照**：base vs compact，50 题 × 3 次；逐题配对统计，输出 `eval/deep/RESULTS-3REP.md`。
2. **压缩策略 preset**：把 `maxContextTokens` / `keepTokens` / `targetAt` 组合成 2-3 个有名字的策略（conservative / balanced / aggressive），在面板/配置中可选，并写清每档的 token/召回取舍。
3. **scaffold 全量复核**：默认 scaffold 跑完整 50 题；决定是否保留 `repo-coder`、是否给长表任务增加一个 opt-in 的“写文件 + 脚本计算”skill。
4. **控制未挂载 UI**：`control.active === false` 时禁用提示词/工具开关并给出原因；`presetMounted` 变化时提示重新同步。
5. **analytics 限额**：`limit` 从固定 40 改为可配置（默认 40，最大 200），并在返回里带覆盖范围；成本价格覆盖补测。
6. **rc.3 兼容**：在隔离 profile 安装 `0.2.1-rc.3`，跑 smoke/control/prompt-state + Tier B 子集；通过后加入 `dshReleases`。
7. **client 行为测试**：补 dock 标签、设置写回、空状态、控制未挂载禁用的测试。

发布门禁：3 reps 结果 + rc.3 证据 + 全量测试 + 无准确率承诺。

### 3.4 0.24.0（minor，“分发与 UX”）

1. **市场/Desktop 验收**：WSL web + Desktop 各做一次安装/启停/面板/余额胶囊验收；截图与 E22 证据。
2. **提示词/工具控制 UX**：控制未挂载状态、错误提示、恢复默认、会话级覆盖的可见性。
3. **`extraPrompts` user 放置**：评估改用官方 `agent.inject()`；如果改，必须保留迁移说明与行为差异。
4. **client 结构**：把 `client.js` 中独立逻辑拆出可测试模块（不要求引入构建链）。
5. **可选**：把脚手架生成器拆成独立包，避免主包继续膨胀。

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
| 单元 | static / metrics / state / scaffold | 每次提交 |
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
| client.js 单文件过大 | UI 回归难定位 | 0.23.0 起补行为测试；0.24.0 拆模块 |
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

## 9. 立即可执行（本周）

1. 冻结 0.22.0，跑完发布门禁并打 tag。
2. 新增 `agent-embodiment/CHANGELOG.md`，回填 0.22.0。
3. 提交/更新市场申请 PR（文案已改为 optional scaffold）。
4. 启动 base vs compact 的 3 reps（先跑 10 多轮 + 5 长上下文子集，再决定是否全量）。
5. 在隔离 profile 试装 DSH `0.2.1-rc.3`，记录结果，不通过就不改矩阵。
