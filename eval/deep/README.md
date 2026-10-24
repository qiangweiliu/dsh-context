# 50 题深度测试套件（Tier B）

固定题库，后续所有“插件 / 不装插件”的对照都使用这一套。

- 生成器：[`v2/make-suite.mjs`](v2/make-suite.mjs)
- 题库：[`questions.jsonl`](questions.jsonl)（50 行，每行一题）
- 可读版：[`questions.json`](questions.json)
- 执行器：[`run.mjs`](run.mjs)
- 条件准备：[`setup-conditions.mjs`](setup-conditions.mjs)
- 旧版 50 题（已被替换）：[`archive/`](archive/)
- 四组对照结果：[`RESULTS.md`](RESULTS.md) · [`COMPARE.md`](COMPARE.md)
- 注意：`COMPARE.md` 里的 scaffold 数据来自旧版“含 process skills”的脚手架；0.22.0 默认关闭 process skills，复核见 `RESULTS.md` §5（工具调用 46.5 → 4.7，准确率恢复）。

## 1. 为什么换掉旧版

旧版 50 题（MATH L5 + 普通代码/长上下文）在 `deepseek-v4.1-flash` 上 46/46 自动题全对，无法区分“装插件/不装插件”。Tier B 专门制造**记忆与长上下文压力**，并让 base 至少在一部分题上失败。

## 2. 题目构成

| 类别 | 数量 | 压力来源 |
|---|---:|---|
| `multi-turn` | 20 | 同一 session 20+ 轮；60 条工作流事实分散在前 12 轮，随后 3 条权威更正，最后要求总和 + 排序 ID |
| `long-context` | 15 | 单次 150-260 条记录（约 1.5-2 万字符），精确聚合/计数/列表 |
| `code` | 9 | 8 道来自旧版 + JSON Patch（RFC 6902），隐藏 `node --test` |
| `agentic` | 6 | 真实仓库 bugfix/feature/refactor/csv/expr/lru |

总计 **50 题**。

## 3. 对照条件

`setup-conditions.mjs` 从现有 headless profile 复制 provider 配置，但把模型声明的窗口调成 **40000**、输出上限 **16000**，并给 `compaction-basic` 设置 `headroomTokens: 1024`、`retainRatio: 0.05`、`maxTokens: 4096`。这样几十轮内就会真正触发压缩，而不是靠 1M 窗口硬扛。

| `--condition` | DSH_HOME | 额外内容 |
|---|---|---|
| `base` | `/tmp/dsh-memory-base` | 仅 `dsh-base` + `dsh-headless` |
| `plugin` | `/tmp/dsh-memory-plugin` | + `agent-embodiment` 宿主半侧 |
| `scaffold` | `/tmp/dsh-memory-plugin` | + 生成的 `repo-coder` skills（`DSH_AGENTS_HOME`；0.22.0 默认只含角色 skill） |
| `compact` | `/tmp/dsh-memory-plugin` | + `control` 行，`compaction-basic auto:false`，预算 18000 / keep 5000 |

准备：

```bash
node eval/deep/setup-conditions.mjs \
  --from ~/.dsh/profiles/headless \
  --credentials ~/.dsh/.credentials.yaml
```

## 4. 运行

```bash
# 先看题目
node eval/deep/run.mjs --dry-run

# 单条件
node eval/deep/run.mjs --condition base --workers 3 --out eval/results/deep-b-base.jsonl
node eval/deep/run.mjs --condition plugin --workers 3 --out eval/results/deep-b-plugin.jsonl
node eval/deep/run.mjs --condition scaffold --workers 3 --out eval/results/deep-b-scaffold.jsonl
node eval/deep/run.mjs --condition compact --workers 3 --out eval/results/deep-b-compact.jsonl

# 断点续跑：同一条命令会自动跳过已完成 id
```

输出：

- 逐题 JSONL：`correct` / `pred` / `gold` / `status` / `turns` / `usage` / `seconds` / `sessionId`。
- 汇总：`<out>-summary.json`。

## 5. 判分

- 多轮/长上下文：`exact`（去空白/逗号空格）或 `numeric`（容差）。
- 代码：agent 结束后写入隐藏测试，运行 `node --test`。
- 仓库任务：`eval/agent-ab/fixture.mjs` 的 `TASKS.verify`。
- 数学（旧版遗留）：`math` + sympy fallback；Tier B 不包含数学题。

## 6. 重要约定

- **不要改题面或 gold**；新增更难题目用新 id（`deep-c-*`）。
- `questions-v2.jsonl` 与 `questions.jsonl` 内容一致；改题后重新生成并同步。
- 多轮题会真实写入 session 日志；`--keep` 可保留工作目录，便于排查。
- 条件 profile 和脚手架都在 `/tmp`，可随时由 `setup-conditions.mjs` 重建。
