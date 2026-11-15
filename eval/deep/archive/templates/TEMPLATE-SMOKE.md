# 模板冒烟（experimental 模板可用性）

> **已归档（0.48.0 决策）**：4 个 `experimental` 模板永久保持 `experimental`，不再做任务级验证。
> 本文件是当时的实验记录，仅供追溯；工具与数据见同目录。决策理由见 [`README.md`](README.md)。

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
,## 7. 有区分度的对照（负结果，2026-11-15）,,第 2 节那 3 道题已经饱和，测不出东西。于是换成**历史上 `base` 真正做错**的题：从 `eval/results/*.jsonl` 里筛出 `cond === base && correct === false && status === ok` 的 Tier B 题（排除 `spawn-error` / `exit-1` 这类基础设施失败），共 4 道，取其中 3 道长上下文题：`deep-b-long-05`、`deep-b-long-10`、`deep-b-long-15`。,,| 条件 | 题数 | 正确 | 平均 toolCalls | 平均秒 | 平均输出字符 |,| --- | ---: | ---: | ---: | ---: | ---: |,| `base`（对照） | 3 | **0** | 2.3 | 87 | 23188 |,| `ops-runbook` | 3 | **0** | 1.3 | 73 | 18509 |,| `browser-operator` | 3 | **0** | 1.7 | 78 | 22113 |,| `data-analyst` | 3 | **0** | 3.0 | 83 | 24874 |,| `support-router` | 3 | **0** | 2.0 | 118 | 24582 |,,逐题（`✗` = 判错，后面是 toolCalls / 秒）：,,```,base-control     long-05:✗/1/59.5   long-10:✗/4/85.5   long-15:✗/2/115.2,ops-runbook      long-05:✗/1/89.2   long-10:✗/1/71.6   long-15:✗/2/57.1,browser-operator long-05:✗/2/66.4   long-10:✗/2/69.4   long-15:✗/1/98.7,data-analyst     long-05:✗/3/103.6  long-10:✗/3/86.2   long-15:✗/3/59.6,support-router   long-05:✗/2/61.4   long-10:✗/2/99.8   long-15:✗/2/191.5,```,,### 怎么读,,**结论是负的，而且这个负结论有价值：**,,- 4 个模板在「精确计数/聚合」类长上下文题上**一个都没救回来**（15 次运行 0 分）。这类失败靠角色技能（`SENSE`/`HANDS`/`LOOP`/persona）解决不了——它要求逐条枚举 150–260 条记录并精确汇总，与「你是什么角色的 agent」无关。,- 成本几乎没变化（73–118 秒 vs 对照 87 秒），说明模板既没帮忙也没拖累。,- `base` 在这 3 题上复现了 0/3，与历史记录（每题各失败 4 次）一致 —— 题目是**稳定地难**，不是偶发波动。,,**所以：** 不要把模板当准确率手段卖。它的作用是给 agent 一个稳定的角色框架与工作流程（第 2 节里同一道代码题 toolCalls 从 9 到 37 就是证据），而不是把难计数题做对。,,### 局限,,- 每格只有 1 次运行（`reps=1`），无法区分方差；要下「模板 X 比 Y 好」的结论至少需要 3 次重复。,- 3 道题都是 `long-context` 类，没有覆盖 `multi-turn` 与 `code` 的失败题（历史 `spawn-error` 占多数，不是真实模型失败）。,- 想让模板转正，正确做法是按模板定位出题（`ops-runbook` 用故障排查、`browser-operator` 用页面操作），而不是继续用长上下文计数题。,,原始数据：`eval/results/template-smoke-hard/*.jsonl`、`SUMMARY.md`。