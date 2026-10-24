# 安装 / 不安装 agent-embodiment 的 Agent 能力对照

日期：2026-10-22 · 执行器：`dsh 0.2.0-rc.2 --profile headless` · 模型：`deepseek-v4.1-flash`（opencode-go）
仓库：`agent-embodiment@0.21.0`

> 后续变更说明（2026-10-23）：本实验的脚手架条件包含 `sense_environment` 工具和 `tool-catalog` skill；后续版本已移除这两项，公共 skill 改用 DSH 原生工具。`scaffold` 条件的数值需要在移除后重跑，不能直接当作当前版本结论。

## 1. 问题与结论

问题：**给 DSH 装上 `agent-embodiment`，agent 的任务能力会变强吗？**

结论（基于 7 类任务 × 3 次重复 × 3 个条件，共 63 次运行）：

1. **任务正确率没有差异**：63/63 全部通过；三个条件的编码任务验证率都是 18/18。当前模型在这些任务上已经饱和，插件没有带来可测的正确率提升。
2. **仅安装插件不改变单轮能力**：`plugin` 与 `base` 的任务通过率相同；插件挂载的是命令、状态面板、预算/压缩控制，不给 agent 增加工具或提示词。
3. **生成脚手架的代价可测，收益不可测**：`scaffold` 条件确实被 agent 使用（21 次运行中 11 次调用 skill、2 次调用 `sense_environment`），但输出 token 平均 +293（95% CI +89～+521），上下文平均 +854 tokens（CI +407～+1298），耗时平均 +3.2s（CI -0.4～+6.6）；正确率仍是 100%。
4. **插件是基础设施，不是“模型增强器”**。它的价值在长会话的上下文可见性/压缩策略、工具与提示词开关、以及可复用的 preset/skill 脚手架；单轮编码准确率不应作为它的卖点。

## 2. 对照条件

三个条件都使用同一份 `headless` profile 配置、同一模型、同一套任务与夹具；每个 run 使用独立工作目录和独立会话。

| 条件 | 内容 | 额外挂载 |
| --- | --- | --- |
| `base` | 干净 DSH，无插件 | 无 |
| `plugin` | 安装 `agent-embodiment`，不生成脚手架 | 无（插件只注册命令/状态路由/控制半侧配置） |
| `scaffold` | 安装插件 + 生成 `repo-coder` 脚手架 | `sense_environment` host tool、`ab-coder-*` skills（`DSH_AGENTS_HOME`） |

`scaffold` 的 preset 本体在 headless 中不会被消费（headless 不挂 `agentPresets` 服务），所以只挂载了脚手架真正提供给 agent 的两类资产：host tool 与工作区/用户 skills。完整 preset 的 fs/web/subagent/todo 工具在 headless 基座中本来就存在。

## 3. 任务

每个任务从同一个可运行的小仓库模板复制，再施加一个确定性变异；判分由测试套件 + 文件约束完成，不依赖人工读答案。

| 任务 | 检查点 | 变异 |
| --- | --- | --- |
| `orientation` | 测试命令、分支、`src/*.mjs` 数量、未提交文件 | README 有一个未提交修改 |
| `bugfix` | `npm test` 通过、`test/` 未被修改 | `add()` 被改成减法 |
| `feature` | 同上 | `slugify()` 抛 not implemented |
| `refactor` | 同上 + `src/` 中不再出现旧 API 名 | `humanizeDuration` 被改回旧名 `formatDuration`，CLI 同步用旧名 |
| `csv` | 同上 | `parseCsv()` 未实现（引号、转义、字段内换行、CRLF） |
| `expr` | 同上 | `evaluate()` 未实现（优先级、括号、一元负号、错误输入） |
| `lru` | 同上 | `LRU` 类未实现（淘汰顺序、更新、容量、size） |

所有任务 prompt 都明确要求“不要改测试、运行测试并报告结果”，因此编码任务天然会触发验证；这不是一个“是否自觉验证”的测试。

## 4. 结果

### 4.1 总体

| 条件 | 通过 | 正确率 | 平均耗时 | 平均工具调用 | 编码任务验证 | 平均输出 token | 平均末步上下文 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `base` | 21/21 | 100% | 20.7s | 5.6 | 18/18 | 891 | 14,340 |
| `plugin` | 21/21 | 100% | 23.2s | 6.7 | 18/18 | 1,032 | 14,568 |
| `scaffold` | 21/21 | 100% | 23.9s | 6.7 | 18/18 | 1,184 | 15,194 |

### 4.2 逐任务（通过数 / 3，括号内平均耗时）

| 任务 | `base` | `plugin` | `scaffold` |
| --- | --- | --- | --- |
| orientation | 3 (8.4s) | 3 (11.2s) | 3 (12.2s) |
| bugfix | 3 (32.9s) | 3 (31.9s) | 3 (27.1s) |
| feature | 3 (18.2s) | 3 (23.1s) | 3 (20.2s) |
| refactor | 3 (21.0s) | 3 (25.8s) | 3 (20.0s) |
| csv | 3 (23.8s) | 3 (22.9s) | 3 (31.9s) |
| expr | 3 (21.2s) | 3 (25.2s) | 3 (35.3s) |
| lru | 3 (19.7s) | 3 (22.4s) | 3 (20.6s) |

### 4.3 配对差异（同任务、同重复次数；bootstrap 95% CI，20,000 次）

| 对比 | 耗时 | 工具调用 | 输出 token | 末步上下文 |
| --- | --- | --- | --- | --- |
| `plugin - base` | +2.50s [-0.30, +5.39] | +1.10 [+0.14, +2.10] | +140 [+7, +284] | +228 [-209, +637] |
| `scaffold - base` | +3.17s [-0.36, +6.61] | +1.05 [-0.19, +2.38] | +293 [+89, +521] | +854 [+407, +1298] |
| `scaffold - plugin` | +0.67s [-3.33, +4.63] | -0.05 [-1.19, +1.00] | +153 [-45, +376] | +626 [+167, +1095] |

符号检验：`scaffold` 相比 `base` 有 18/21 次输出 token 更多、15/21 次更慢；`plugin` 相比 `base` 有 14/21 次输出 token 更多。方向一致，但任务间方差大，不能把单次耗时差当成稳定常数。

### 4.4 脚手架使用情况

- `scaffold` 21 次运行中：`skill` 调用 11 次（`repo-coder`、`verify-change`、`tool-catalog` 等），`sense_environment` 调用 2 次。
- `base` 21 次运行中：`skill` 调用 1 次（用户级 skill 的偶发使用），无 `sense_environment`。
- 使用了脚手架的 run 并没有更快通过；例如 `expr` 的 3 次 `scaffold` 运行耗时 32.0/38.9/35.1s，`base` 为 15.7/31.0/17.0s，差异主要来自模型生成的实现长度与自检轮数，而不是工具数量。

## 5. 解释

### 为什么“安装插件”本身没有能力收益

`agent-embodiment` 宿主半侧做的是：

- `/embody`、`/embody <tokens>`、`/embody reset` 命令；
- `/api/agent-embodiment/status` 状态接口与面板数据；
- 会话级工具/提示词开关、全局配置写入；
- `system-prompt/assemble` 钩子（只影响装配，不默认注入提示词）。

它不改模型、不改系统提示词、不注册 agent 工具。`control` 半侧要挂进 preset，且默认 `mode: idle`，只在用户触发/兜底时压缩。因此单轮 headless 任务中它没有可作用的路径，这与测量结果一致。

### 脚手架为什么有成本没收益

脚手架给 agent 增加了：

- `sense_environment` 工具定义与一次环境快照；
- 5 个 skill 的目录条目，以及被模型实际加载时的正文；
- 更明确的“先感知、再修改、再验证”流程提示。

这些资产在**开放式、长链路、需要反复定位环境的任务**里可能减少探索成本；本次任务都是 5 个源文件、单 bug/单模块实现，模型用 `bash`/`read`/`grep` 已能一次定位，脚手架没有发挥空间，只增加了工具选择与上下文开销。

### 上下文压缩没有被本实验覆盖

`dsh headless` 是单轮执行：`control.js` 的 `agent/pre-step` 压缩钩子没有跨用户轮次可压，一次任务内的上下文也不足以触发默认预算。要评估压缩策略，需要多轮 Web/Desktop 会话，或构造超过预算的连续对话；本次不把“压缩提升能力”纳入结论。

## 6. 适用建议

- **要提升单轮代码正确率**：换更强模型或改提示词/输出契约，`agent-embodiment` 不是这项工具；本次 63/63 也说明当前模型在这些任务上没有提升空间。
- **要长会话可控**：装插件，用 `/embody` 看预算、在 preset 里挂 `control`，并按需开启自动压缩；这部分是插件的主价值。
- **要可复用的 agent 工作方式**：用 Agent 脚手架生成 preset + skills，再在真实多文件仓库、长任务上做自己的 A/B；本次简单仓库任务不足以证明脚手架收益，但也不支持“装了就更聪明”的说法。

## 7. 复现

```bash
# 1. 准备隔离 DSH_HOME：复制一份 headless profile 与凭据
#    （本实验为 /tmp/dsh-ab，未触碰真实 profile）
# 2. 三个 profile：ab-base / ab-plugin-only / ab-plugin
#    ab-plugin 额外安装 agent-embodiment 与生成的 repo-coder 脚手架
# 3. 生成脚手架与 skills
node scripts/agent-scaffold.mjs --template repo-coder --out /tmp/ab-scaffold --slug ab-coder
# 4. 跑 63 次（3 条件 × 7 任务 × 3 次）
node eval/agent-ab/run.mjs --reps 3 --workers 3
```

产物：

- `eval/agent-ab/fixture.mjs`：夹具、变异与判分；
- `eval/agent-ab/run.mjs`：A/B/C 执行器、会话日志解析、统计；
- `eval/results/plugin-ab.jsonl`：63 条原始结果（含工具名、token、上下文、最终回答）；
- `eval/results/plugin-ab-summary.json`：汇总。

复现环境差异：Windows 桌面版 DSH 与 Linux headless 的工具集合/提示词栈不同，结论只适用于 `dsh 0.2.0-rc.2 headless + deepseek-v4.1-flash`；不能直接外推到 Web/Desktop 或其它模型。
