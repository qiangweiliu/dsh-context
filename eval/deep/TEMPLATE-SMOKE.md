# 模板冒烟（experimental 模板可用性）

日期：2026-11-15　｜　模型：`deepseek-v4.1-flash`（provider 路由 `opencode-go`，走 `llm-pi-ai`）  
条件：`scaffold`（脚手架 skills 挂载）对比 `base`（不挂任何脚手架）  
题目：3 题（`deep-b-memory-01` 多轮记忆 / `deep-b-long-01` 长上下文 / `deep-b-code-csv` 代码）

## 1. 目的

`repo-coder` / `web-researcher` 之外的 4 个模板（`ops-runbook`、`browser-operator`、`data-analyst`、`support-router`）一直标着 `experimental`，因为从未做任务验证。这次只需要回答一个问题：**这些模板生成的 agent 能不能正常干活、会不会把流程搞坏。**

## 2. 结果

| 条件 | 题数 | 正确 | 平均 toolCalls | 平均秒 | 平均输出字符 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ops-runbook` | 3 | 3 | 12.7 | 175 | 51769 |
| `browser-operator` | 3 | 3 | 7.0 | 113 | 25603 |
| `data-analyst` | 3 | 3 | 8.3 | 154 | 33798 |
| `support-router` | 3 | 3 | 3.7 | 83 | 14192 |
| `base`（对照） | 3 | 3 | 8.3 | 132 | 33423 |

逐题 toolCalls（`✓` 表示判分通过）：

```
ops-runbook      memory-01:1✓  long-01:0✓  code-csv:37✓
browser-operator memory-01:1✓  long-01:0✓  code-csv:20✓
data-analyst     memory-01:1✓  long-01:2✓  code-csv:22✓
support-router   memory-01:1✓  long-01:1✓  code-csv:9✓
base-control     memory-01:1✓  long-01:0✓  code-csv:24✓
```

## 3. 怎么读这组数

**能下的结论：**

- 4 个模板全部**跑得通、不报错**（12/12 `status: ok`），脚手架注入没有破坏 agent 的循环、工具调用或判分链路。
- 模板确实改变了**过程**：同一道代码题，`ops-runbook` 用了 37 次工具调用、175 秒，`support-router` 只用了 9 次、83 秒。差异来自 persona / skills 的引导强度，不是随机波动。
- `support-router` 是这批里最省的一个（对照 `base` 的 24 次 / 132 秒，它用 9 次 / 83 秒完成任务）。

**不能下的结论：**

- **不能说模板带来了准确率提升。** 3 道题在 `base` 下也全对（15/15 全对），题目对 `deepseek-v4.1-flash` 太容易，已经饱和，没有区分度。这与 `RESULTS.md` 的记录一致：Tier B 的多数题对当前模型是「基准题」，不是「压力题」。
- 也不能说 `ops-runbook` 更差。它只是更啰嗦；在只有一题是代码题的情况下，工具调用多不等于答案差。

## 4. 复现

```bash
# 需要可用的 opencode 凭据（环境变量 OPENCODE_GO_API_KEY）
node eval/deep/setup-conditions.mjs \
  --from ~/.dsh/profiles/headless --credentials ~/.dsh/.credentials.yaml \
  --base-home ~/.cache/embody-eval/base-home \
  --plugin-home ~/.cache/embody-eval/plugin-home \
  --scaffold-home ~/.cache/embody-eval/scaffold

node eval/deep/template-smoke.mjs \
  --ds-home ~/.cache/embody-eval/plugin-home \
  --scaffold-root ~/.cache/embody-eval/templates \
  --workers 1 --timeout 480

node eval/deep/run.mjs --condition base \
  --ds-home ~/.cache/embody-eval/base-home \
  --ids deep-b-memory-01,deep-b-long-01,deep-b-code-csv \
  --workers 1 --out eval/results/template-smoke/base-control.jsonl
```

原始结果：`eval/results/template-smoke/*.jsonl`、`SUMMARY.md`、`summary.json`。

## 5. 下一步建议

要让这 4 个模板从 `experimental` 转正，缺的是**有区分度的题**，而不是更多次重复：

1. 从 `questions.jsonl` 里挑 `base` 会失败的题（`RESULTS.md` 有记录）当压力题，每模板跑 5–10 题。
2. 专门为 `ops-runbook`（故障排查）与 `browser-operator`（浏览器操作）各写 3 道贴近模板定位的题——现在用「代码题」衡量运维模板本身就不公平。
3. 对 `data-analyst` 与 `support-router`，用长上下文里的聚合/计数题更合适。

## 6. 环境备注

- headless profile 走 `llm-pi-ai` 的 `opencode-go` 路由，凭据来自 `OPENCODE_GO_API_KEY`。若机器上只有桌面版的账号凭据（`deepseek-account-platform`），这些运行会以 `MISSING_CREDENTIAL` 失败。
- WSL 的 `/tmp` 在实例空闲后会被清空，条件目录必须放持久路径（本文用 `~/.cache/embody-eval`）。
