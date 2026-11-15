# 已归档：模板任务评估（2026-11-15 决策）

**结论：4 个 `experimental` 模板永久保持 `experimental`，不再做任务级验证。** 本目录是这套评估的全部遗留物，仅供追溯，不再维护、不再运行。

## 为什么停掉

模板评估只服务一个决定：要不要把 `ops-runbook` / `browser-operator` / `data-analyst` / `support-router` 从 `experimental` 转正。

实际跑下来：

1. **两轮都没能回答这个问题。** 第一轮 3 题饱和（不挂模板也全对）；第二轮换成历史上 `base` 做错的题，修完判分错误后仍是两组同样的分数——题目没有区分度。
2. **成本不划算。** 每轮要起多个隔离 `dsh` 实例、消耗模型配额；而出过错判（`forbidden` 用裸关键词把「No reboot」判成违规、两个 gold 时间戳标错），返工成本高。
3. **不转正也不影响发布。** 标注 `experimental` 本身就是诚实的做法：用户看到就知道「这个模板没做过任务验证」。1.0 门禁不包含「模板必须转正」。

## 保留了什么

| 保留 | 位置 | 说明 |
| --- | --- | --- |
| 结构校验（126 项） | `agent-embodiment/test/templates.mjs` | 每次 PR 都跑，回答「**装得上吗**」：bundle 合法、skill 能被扫描、frontmatter 完整、无未替换占位、experimental 必须带警示。不需要模型。 |
| 模板本身 | `agent-embodiment/scaffold.js` | 6 个模板照常可用，4 个仍标 `experimental`。 |
| 实验记录 | 本目录 `TEMPLATE-SMOKE.md` / `TEMPLATE-PROMOTION.md` | 含方法、数据、踩过的 4 个坑，供将来重开时参考。 |
| 原始数据 | 本目录 `results/` | 每题的 `answer` 全文都在，可离线重判。 |

## 归档了什么

- `questions-templates.jsonl`：6 道定向题（运维 3 + 浏览器 3）。
- `template-smoke.mjs`：批量跑模板冒烟（生成脚手架 + 跑固定题 + 汇总）。
- `template-conditions.mjs`：模板评估用的隔离环境（单套 home、不缩窗口、不复制凭据）。
- 三个结果目录（原 `eval/results/` 下）。

## 如果将来要重开

先读 `TEMPLATE-PROMOTION.md` §2 与 §8，那里记着两条硬教训：

1. **先验证题目难度**：新题必须先跑 `base`，`base` 做对了说明题目没用，直接弃用。
2. **`forbidden` 只放「答错就必然出现」的错值**：题目自己说了「不要 X」时，正确回答必然会提到 X，写进 `forbidden` 会造成假阴性。

另外注意 `results/` 里那批数据是在「40000 窗口 + 激进 compaction」的旧环境下跑的（环境问题已在 `TEMPLATE-PROMOTION.md` §8 修正），重跑时用 `template-conditions.mjs` 的配置思路，别复用 `setup-conditions.mjs` 的 tuning。