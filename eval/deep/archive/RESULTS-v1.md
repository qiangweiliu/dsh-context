# 50 题深度套件 · 首次真实运行

日期：2026-10-23
执行器：`dsh 0.2.0-rc.2 --profile headless`（`--json`）· 模型：`deepseek-v4.1-flash`（opencode-go）
套件：`eval/deep/questions.jsonl`（50 题，固定不替换）· 每 Rep 1 次 · 3 并发
结果：`eval/results/deep-final.jsonl`（46 自动判分 + 4 人工 rubric）

## 1. 总览

| 类别 | 题数 | 自动判分 | 正确 | 正确率 | 平均耗时 |
|---|---:|---:|---:|---:|---:|
| `math-l5` | 10 | 10 | 10 | 100% | 30.2s |
| `code` | 8 | 8 | 8 | 100% | 150.8s |
| `agentic` | 6 | 6 | 6 | 100% | 59.5s |
| `long-context` | 8 | 8 | 8 | 100% | 14.5s |
| `data-analysis` | 8 | 8 | 8 | 100% | 8.2s |
| `robustness` | 6 | 6 | 6 | 100% | 8.0s |
| `planning` | 4 | 0 | — | 人工 | 81.9s |
| **合计** | **50** | **46** | **46** | **100%** | — |

数学题用 `eval/grade-math.py` 复核：**10/10，sympy 无法解析 0/10**。

Planning 题按 rubric 关键词命中的情况（仅供人工复核，不计入自动正确率）：

| 题 | rubric 命中 |
|---|---|
| `deep-plan-1-migration` | 5/5 |
| `deep-plan-4-postmortem` | 6/6 |
| `deep-plan-2-estimate` | 4/5（缺 `dependency` 关键词） |
| `deep-plan-3-flaky` | 4/5（缺 `isolation` 关键词） |

## 2. 结论

1. **当前模型在这套题上已经饱和**：46/46 自动题全对。说明这 50 题不足以区分 `deepseek-v4.1-flash` 的能力高低，更适合作为回归基线，而不是“难题排行榜”。
2. **耗时仍有区分度**：`code-lru` 用时 565.6s（接近 600s 超时），是全部题里最慢的一题；正确但很吃力。
3. **长上下文抽取没有拉开差距**：8 题全部一次通过，avg 14.5s。要测压缩收益，需要构造跨轮/超预算会话，而不是单次长 prompt。
4. **鲁棒性题全部通过**：注入、伪系统消息、secret、JSON 契约、缺失日期、破坏性请求都没有让模型犯错。

## 3. 本次修正记录

首次完整运行出现 2 个自动判分失败，复核后都不是模型能力问题：

- `deep-math-01`：模型输出 `4√2`，gold 为 `4\sqrt{2}`；判分器补了 Unicode `√`/`π` 归一化。
- `deep-data-05`：gold 的 ISO 时间没有处理跨天（hour 27 应为 `2026-03-03T03:00Z`），已修正生成器。
- `deep-data-02` / `deep-data-04`：题面补了“endpoint 原样”“保留 TCK- 前缀”，避免输出格式歧义。

修正后重跑这两个 id，均通过；`deep-final.jsonl` 已合并重跑结果。

## 4. 复现

```bash
# 题库与参考实现自检
node eval/deep/make-suite.mjs --check

# 完整 50 题
node eval/deep/run.mjs --workers 3 --timeout 600 --out eval/results/deep-full.jsonl

# 数学复核
python3 eval/grade-math.py <(grep '"category":"math-l5"' eval/results/deep-final.jsonl)
```

> 注意：`<(...)` 需要 bash；也可以先把 math 行过滤到临时文件再交给 `grade-math.py`，它需要 `seconds` 字段。

## 5. 下一步

- 这套题作为**固定回归基线**保留，不再替换；新增更难题目时使用新 id，例如 `deep-b-*`。
- 若要恢复区分度，建议追加 Tier B：多约束组合、跨文件重构、需要多轮的压缩/召回任务，而不是继续增加单步推理题。
- 真正评估 `agent-embodiment` 时，用同一套题跑 `base` / `plugin` / `scaffold` / `compact-on` 四组；当前这份结果是 `base`（干净 headless）。
