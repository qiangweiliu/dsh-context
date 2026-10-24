# Tier B 50 题 · 四组对照结果

日期：2026-10-24
模型：`deepseek-v4.1-flash`（opencode-go）
执行器：`dsh 0.2.0-rc.2 --profile headless --json`
测试条件：隔离 `DSH_HOME`，模型声明的窗口 40000、输出上限 16000；`compaction-basic` 使用 `headroomTokens=1024`、`retainRatio=0.05`、`maxTokens=4096`，确保几十轮内真实触发压缩。

## 1. 结论

1. **准确率没有稳定差异**：单次完整运行看起来 base 47/50、plugin 44/50、scaffold 42/50、compact 46/50，但把所有差异题补跑第 2 次后，`plugin`/`scaffold`/`compact` 的失败**全部恢复为正确**。这些差异是模型随机性，不是插件效果。
2. **唯一稳定的失败是 3 道长上下文账本题**：`deep-b-long-05`、`-10`、`-15`。base 第 1、2 次都答错，另外三组也全部答错；插件没有修复它们。这满足“base 不能答对全部题目”，但差异不是插件带来的。
3. **compact 的 token 收益在全量 3 reps 下没有复现**：单次全量曾显示 input −28%，但 150 次/条件的配对结果只有 −363 tokens（95% CI −2,941～+2,227），准确率 129/150 vs 121/150（McNemar p=0.200），output/耗时也无显著差异。
4. **scaffold 组有明显成本，没有可测收益**：平均工具调用 15.2 vs 5.5、output token 5,617 vs 4,332、耗时 87.4s vs 79s；补齐第 2 次后准确率与 base 相同。
5. **plugin 组（仅宿主半侧）没有改变准确率**；它的 input token 较低（16,416 vs 22,317），但这不是压缩造成的，可能来自不同的请求组合/运行方差。

一句话：**这套题能证明 base 不是全对，但没有证明“装插件更准”；能测出来的差异是 compact 省 token、scaffold 增加工具调用和输出。**

## 2. 总表（第 1 次完整运行）

| 条件 | 正确 | 正确率 | 平均耗时 | 平均 input | 平均 output | 平均工具调用 |
|---|---:|---:|---:|---:|---:|---:|
| base | 47/50 | 94% | 79.0s | 22,317 | 4,332 | 5.5 |
| plugin | 44/50 | 88% | 69.2s | 16,416 | 3,704 | 5.1 |
| scaffold | 42/50 | 84% | 87.4s | 21,803 | 5,617 | 15.2 |
| compact | 46/50 | 92% | 70.6s | 15,980 | 4,348 | 5.2 |

分类别：

| 类别 | base | plugin | scaffold | compact |
|---|---:|---:|---:|---:|
| multi-turn | 20/20 | 18/20 | 16/20 | 19/20 |
| long-context | 12/15 | 12/15 | 12/15 | 12/15 |
| code | 9/9 | 8/9 | 8/9 | 9/9 |
| agentic | 6/6 | 6/6 | 6/6 | 6/6 |

## 3. 第 2 次复核（关键差异题）

| 条件 | 复核题 | 第 1 次 | 第 2 次 |
|---|---|---|---|
| base | memory-11, code-json-patch | ✓ / ✓ | ✓ / ✓ |
| plugin | memory-11, memory-15, code-json-patch | ✗ / ✗ / ✗ | ✓ / ✓ / ✓ |
| scaffold | memory-04, -05, -08, -11, code-json-patch | ✗ / ✗ / ✗ / ✗ / ✗ | ✓ / ✓ / ✓ / ✓ / ✓ |
| compact | memory-09 | ✗ | ✓ |
| base | long-05, -10, -15 | ✗ / ✗ / ✗ | ✗ / ✗ / ✗ |

复核文件：`eval/results/deep-b-rep2-*.jsonl`。

## 4. 怎么解释

- 多轮记忆题在 40000 窗口 + 5% 保留下仍然大多能靠压缩摘要答对；补跑后差异消失，说明模型对摘要的利用很稳定，单次失败是随机波动。
- 三道长上下文账本题（约 140 个订单 + 70 个退款记录）在所有条件下都算错，错误值固定（如 11697.16 vs 12684.69），属于模型对长表筛选/关联的系统性注意力错误。插件既不修复也不加重。
- compact 组用 `control` 主动压低预算，确实减少了 input token；但在这套题上没有带来准确率收益。
- scaffold 组加载 skills 后工具调用显著增多、输出变长、耗时增加；准确率没有提升，说明当前 scaffold 在这类任务上是成本项。

## 5. 默认脚手架复核（process skills 改为 opt-in）

旧 scaffold 结果包含 `sense-environment` / `verify-change` 两个 process skill；0.22.0/0.23.0 改为默认不生成、需 `--process-skills` 才开启。

### 10 道多轮题子集

| 条件 | 正确 | 平均耗时 | 平均工具调用 | 平均 output | 平均 input |
|---|---:|---:|---:|---:|---:|
| base | 10/10 | 111.2s | 0.9 | 1,572 | 27,829 |
| scaffold（旧，含 process skills） | 7/10 | 193.0s | 46.5 | 9,994 | 46,990 |
| scaffold（默认，仅角色 skill） | 10/10 | 129.0s | 4.7 | 2,597 | 29,792 |

### 全量 50 题

| 条件 | 正确 | 平均耗时 | 平均工具调用 | 平均 output | 平均 input |
|---|---:|---:|---:|---:|---:|
| base | 47/50 | 79.0s | 5.5 | 4,332 | 22,317 |
| scaffold（旧，含 process skills） | 42/50 | 87.4s | 15.2 | 5,617 | 21,803 |
| scaffold（默认，仅角色 skill） | 46/50 | 72.0s | 5.1 | 3,836 | 18,817 |

结论：

- 默认关闭 process skills 后，工具调用从 **15.2 降到 5.1**，output 从 5,617 降到 3,836，耗时 87.4s 降到 72s；准确率从 42 回到 46。
- 与 base 相比，默认 scaffold 只少 1 题（memory-03，单次波动），input −15.7%、output −11.5%、工具调用 −7%、耗时 −9%；仍然没有可测的准确率收益。
- process skills 保留为显式 opt-in；默认 scaffold 继续标 experimental。

结果文件：`eval/results/deep-b-scaffold-default-subset.jsonl`、`eval/results/deep-b-scaffold-default.jsonl`。

## 6. 3 reps 子集（8 题 × 3 次）

条件：5 道多轮（memory-01..05）+ 3 道长上下文（long-01/02/05），base 与 compact 各 3 次。

| 条件 | 通过 | 通过率 | 平均耗时 | 平均 input | 平均 output |
|---|---:|---:|---:|---:|---:|
| base | 19/24 | 79.2% | 79.4s | 23,715 | 3,277 |
| compact | 20/24 | 83.3% | 76.6s | 20,525 | 4,166 |

逐题：
- `long-05` 在 base/compact 都是 **0/3**，确认是系统性长表错误，不是随机。
- 多轮题：base 13/15，compact 14/15；差异来自 memory-02 / memory-04 的单次波动。
- compact 的 input token 节省在这批题上是 **−13.5%**，低于第 1 次全量的 −28%；长上下文题上 compact 的 input 有时反而更高（如 long-01 11.8k vs 5.9k，摘要与重试开销）。
- 全量 3 reps 后该差异没有复现，见下一节。

## 7. 全量 3 reps（150 次/条件）

| 条件 | 通过 | 通过率 | 平均耗时 | 平均 input | 平均 output | 平均工具调用 |
|---|---:|---:|---:|---:|---:|---:|
| base | 121/150 | 80.7% | 73.6s | 21,133 | 3,933 | 6.0 |
| compact | 129/150 | 86.0% | 70.7s | 20,770 | 4,199 | 5.4 |

逐次配对（同题同 rep）：

- concordant：both pass 110，both fail 10；
- discordant：base 赢 11，compact 赢 19；
- McNemar 精确检验：**p = 0.200**（不显著）；
- input 差值：**−363 tokens/次，95% CI [−2,941, +2,227]**（不显著）；
- output 差值：+266，CI [−293, +807]；耗时 −2.9s，CI [−10.4, +4.5]；
- `long-05` 在两组都是 **0/3**，仍是系统性长表错误。

结论：**compact 的准确率、token、耗时差异都没有统计显著性**。单次全量的 −28% 是任务组合与随机波动造成的，不能作为卖点。当前唯一可说的是它不改变准确率、也不稳定地节省 token。

## 8. 复现

```bash
node eval/deep/setup-conditions.mjs \
  --from ~/.dsh/profiles/headless \
  --credentials ~/.dsh/.credentials.yaml

node eval/deep/run.mjs --condition base --workers 2 --out eval/results/deep-b-base.jsonl
node eval/deep/run.mjs --condition plugin --workers 2 --out eval/results/deep-b-plugin.jsonl
node eval/deep/run.mjs --condition scaffold --workers 2 --out eval/results/deep-b-scaffold.jsonl
node eval/deep/run.mjs --condition compact --workers 2 --out eval/results/deep-b-compact.jsonl

node eval/deep/compare.mjs
```

## 9. 局限

- 完整运行只做了 1 次；差异题补做了第 2 次。要做正式结论建议每条件 3 次，用逐题配对而不是聚合差。
- 模型是 `deepseek-v4.1-flash`，结论不能外推到其他模型。
- 声明的 40000 窗口是为了在可接受轮数内触发压缩，不是模型真实容量；它检验的是压缩策略，不是 1M 窗口能力。
- 本结果只覆盖 headless；Web/Desktop 的 preset、UI 与 HITL 不在其中。
