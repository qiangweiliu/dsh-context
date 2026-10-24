# 50 题深度测试套件

固定题库，后续所有能力对照都使用这一套，不再临时换题。

- 生成器：[`make-suite-v1.mjs`](make-suite-v1.mjs)
- 题库：[`questions.jsonl`](questions.jsonl)（50 行，每行一题，含判分元数据）
- 可读版：[`questions.json`](questions.json)
- 代码题参考实现：[`reference/`](reference/)（只用于自检，不提供给被测 agent）
- 执行器：[`run.mjs`](run.mjs)
- 首次真实运行结果：[`RESULTS.md`](RESULTS-v1.md)（2026-10-23，46/46 自动题通过）

## 1. 题目构成

| 类别 | 数量 | 测什么 | 判分 |
|---|---:|---|---|
| `math-l5` | 10 | 数学深度推理（MATH Level 5，几何/代数/数论/微积分） | 归一化表达式 / 数值 / 多解 |
| `code` | 8 | 单文件实现：CSV、表达式求值、LRU、JSON Pointer、SemVer、区间合并、拓扑排序、滑动窗口限流 | 隐藏 `node --test` |
| `agentic` | 6 | 真实仓库任务：bugfix、feature、refactor、csv/expr/lru | 仓库测试 + 文件约束 |
| `long-context` | 8 | 长上下文抽取、纠正覆盖、冲突识别、跨记录聚合 | 精确串 / 数值 |
| `data-analysis` | 8 | CSV/日志/JSON/正则/时间序列/校验/异常/单位换算 | JSON / 精确串 / 数值 |
| `robustness` | 6 | 注入、伪系统消息、secret、输出契约、缺失数据、破坏性请求 | 必需/禁止子串、JSON |
| `planning` | 4 | 迁移、估算、flaky 调试、事故复盘 | 人工/评委 rubric |

总计 **50 题**。没有 GSM8K 式一步题；数学全部来自 MATH Level 5，代码题都有隐藏边界测试。

## 2. 运行

```bash
# 校验题库与参考实现（不调用模型）
node eval/deep/archive/make-suite-v1.mjs --check

# 只列出题目
node eval/deep/run.mjs --dry-run

# 小样本试跑（推荐先跑 1 个类别）
node eval/deep/run.mjs --category code --limit 3 --workers 1

# 跑全套，2 并发
node eval/deep/run.mjs --workers 2 --out eval/results/deep-main.jsonl

# 断点续跑：同一条命令会自动跳过已完成的 id|rep
```

前置条件：

- `dsh` 在 `~/.local/bin/dsh`，或设置 `DSH_BIN`。
- `--profile headless` 可用，并已配置模型凭据（本仓库默认示例使用 `OPENCODE_GO_API_KEY`）。
- 需要隔离环境时传 `--ds-home /tmp/dsh-deep`，并先准备该 profile 与凭据；不传则使用当前 `DSH_HOME`。
- 代码题需要 `node`；agentic 题需要 `git` 与 `npm`。

输出：

- `eval/results/deep-*.jsonl`：逐题结果（`correct`、`pred`、`gold`、`seconds`、`toolCalls`、`detail`、最后回答）。
- `eval/results/deep-*-summary.json`：按类别汇总（`graded` / `correct` / `manual` / `failed`）。

数学题额外用官方判分器复核：

```bash
python3 eval/grade-math.py eval/results/deep-main.jsonl
```

（`run.mjs` 也内置了归一化判分，`grade-math.py` 是更严格的 sympy 口径。）

## 3. 判分类型

| `verify.type` | 含义 |
|---|---|
| `math` | 归一化 LaTeX + 数值容差 + 多解集合 |
| `numeric` | 取最后数字，支持 `decimals` 容差 |
| `exact` | 去空白/大小写后精确比较，可带 `forbidden` |
| `contains` | 必需子串全部出现，禁止子串全部不出现 |
| `json` | 从回答中取 JSON，深比较（对象键顺序无关） |
| `tests` | 写入隐藏测试后运行 `node --test` |
| `agentic` | 复用 `eval/agent-ab/fixture.mjs` 的仓库校验 |
| `rubric` | 人工/评委判分，执行器记录 `manual:true`，不计入自动正确率 |

## 4. 建议的对照矩阵

这套题用于回答“插件到底有没有用”，建议固定以下条件：

| 条件 | 说明 |
|---|---|
| `base` | 干净 DSH |
| `plugin` | 安装 agent-embodiment，不生成脚手架 |
| `scaffold` | 安装插件 + 生成 `repo-coder` / `web-researcher` |
| `compact-off` | 关闭自动压缩 |
| `compact-on` | 插件控制半侧按低触发线压缩 |

重点指标：

- 总体正确率（分类别）。
- `long-context` 与 `agentic` 的差异（最可能显形）。
- 压缩前后 `long-context` 召回率、input token、耗时。
- `code` / `agentic` 的隐藏测试通过率，而不是模型自述。

## 5. 维护约定

- **不要改题面或 gold**：后续对照必须用同一版本。需要新增题时加新 id，不要替换旧题。
- 题目由 `make-suite-v1.mjs` 生成；上下文与数据使用固定种子，gold 由同一份数据计算。
- 修改生成器后先跑 `--check`，确认 8 个代码题的参考实现全部通过。
- `reference/` 是答案，不要放进给 agent 的工作目录。
- 手工 rubric 题（`planning`）需要人工或评委模型评分；执行器只记录回答与 rubric 命中情况。
