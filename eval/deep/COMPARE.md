# Tier B 对照结果

生成时间：2026-10-23T19:21:48.696Z

| 条件 | 题数 | 正确 | 正确率 | 平均耗时 | 平均 input | 平均 output | 平均工具调用 |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 50 | 47 | 94% | 79s | 22317 | 4332 | 5.5 |
| plugin | 50 | 44 | 88% | 69.2s | 16416 | 3704 | 5.1 |
| scaffold | 50 | 42 | 84% | 87.4s | 21803 | 5617 | 15.2 |
| compact | 50 | 46 | 92% | 70.6s | 15980 | 4348 | 5.2 |

## 分类别

| 类别 | base 正确/题数 | plugin 正确/题数 | scaffold 正确/题数 | compact 正确/题数 |
|---|---:|---:|---:|---:|
| multi-turn | 20/20 | 18/20 | 16/20 | 19/20 |
| long-context | 12/15 | 12/15 | 12/15 | 12/15 |
| code | 9/9 | 8/9 | 8/9 | 9/9 |
| agentic | 6/6 | 6/6 | 6/6 | 6/6 |

## plugin vs base：正确性变化

| 题目 | base | plugin | 说明 |
|---|---:|---:|---|
| deep-b-memory-11 | ✓ | ✗ | exact |
| deep-b-memory-15 | ✓ | ✗ | exact |
| deep-b-code-json-patch | ✓ | ✗ | hidden tests failed:   at applyPatch (file:///tmp/deep-runs/deep-b-code-json-pat |

plugin 失败题：deep-b-memory-11, deep-b-memory-15, deep-b-long-05, deep-b-long-10, deep-b-long-15, deep-b-code-json-patch

## scaffold vs base：正确性变化

| 题目 | base | scaffold | 说明 |
|---|---:|---:|---|
| deep-b-memory-04 | ✓ | ✗ | exact |
| deep-b-memory-08 | ✓ | ✗ | exact |
| deep-b-memory-11 | ✓ | ✗ | exact |
| deep-b-memory-05 | ✓ | ✗ | exact |
| deep-b-code-json-patch | ✓ | ✗ | hidden tests failed:    at applyPatch (file:///tmp/deep-runs/deep-b-code-json-pa |

scaffold 失败题：deep-b-memory-04, deep-b-memory-08, deep-b-memory-11, deep-b-memory-05, deep-b-long-05, deep-b-long-10, deep-b-long-15, deep-b-code-json-patch

## compact vs base：正确性变化

| 题目 | base | compact | 说明 |
|---|---:|---:|---|
| deep-b-memory-09 | ✓ | ✗ | exact |

compact 失败题：deep-b-memory-09, deep-b-long-05, deep-b-long-10, deep-b-long-15
