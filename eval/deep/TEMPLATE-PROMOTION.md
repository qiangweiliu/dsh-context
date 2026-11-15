# 模板转正评估（ops-runbook / browser-operator）

日期：2026-11-15　｜　模型：`deepseek-v4.1-flash`（`opencode-go` 路由）　｜　结论：**两个模板都不转正**

## 1. 结论先行

| 模板 | 定向 3 题（base / 模板） | 判定 | 原因 |
| --- | --- | --- | --- |
| `ops-runbook` | **3 / 3** | 不转正 | 题目无区分度：不挂模板也全对，测不出模板价值 |
| `browser-operator` | **2 / 3 → 3 / 3** | 不转正 | 唯一有区分度的 1 道题被救回，但 n=1，证据不足 |

两个模板继续标 `experimental`。理由不是「模板差」，而是**没有拿到能证明它更好的证据**。

## 2. 这一轮先犯的错（必须记下来）

第一轮跑完，我得到的是「`ops-runbook` 0/3、`base` 1/3，模板把对题做错了」。看着像一个有价值的负结论。**但那是假的，三个失败全部是我出题的错：**

1. **`forbidden` 用裸关键词匹配**：模型写「No reboot, and no restarting the unit before `nginx -t` passes」——这是**正确**回答，却因为出现 "reboot" 被判违规。`base` 的「without using rollback-3」同理被误判。
2. **gold 时间戳取错**：`tpl-ops-01` 问「首个异常事件」，我标 `09:42:11`（开始拉取），但日志里首个异常行是 `09:42:58` 的 `Back-off pulling image`。模型答 `09:42:58` 是对的。
3. **gold 时间戳又错一次**：`tpl-ops-02` 问「首次饱和并开始排队」，我标 `07:57:00`（waiting=17），但 `07:56:50` 的 `waiting=2` 才是首次。模型又是对的。
4. **参数题有多个合理答案**：我问「改哪个参数」，gold 写 `max_connections`，模型答 `statement_timeout=5000`——在「限制慢查询占用连接」这个意图下同样合理，甚至更对症。

修正后重跑时 **OpenCode Go 月度 quota 用尽**（`GoUsageLimitError`，`resets in 3d 23h`），无法再调模型。但 `run.mjs` 把答案全文存进了 jsonl，**重判是确定性的**，于是用修正后的规则对已存答案离线重判——不需要模型。

## 3. 修正规则后的数据（离线重判）

判分逻辑与 `eval/deep/run.mjs` 的 `contains` 分支逐字对齐（`normalizeText` + `required` / `forbidden`）。

### ops-runbook（3 题）

| 条件 | 题数 | 正确 | 逐题 |
| --- | ---: | ---: | --- |
| `base`（不挂脚手架） | 3 | **3** | ops-01:✓ ops-02:✓ ops-03:✓ |
| `ops-runbook` | 3 | **3** | ops-01:✓ ops-02:✓ ops-03:✓ |

**无差异。** 3 道题在两种条件下都被做对，说明它们对 `deepseek-v4.1-flash` 不够难，无法回答「模板有没有帮忙」。

### browser-operator（3 题）

| 条件 | 题数 | 正确 | 逐题 |
| --- | ---: | ---: | --- |
| `base`（不挂脚手架） | 3 | **2** | browser-01:✓ browser-02:✓ browser-03:✗ |
| `browser-operator` | 3 | **3** | browser-01:✓ browser-02:✓ browser-03:✓ |

唯一有区分度的是 `tpl-browser-03`：同一订单号 `A-1043` 同时出现在「2026-09 过期导出」（1000.00）与「当前页」（1842.00），`base` 报了过期值，`browser-operator` 报对了当前值并给出状态 `refunded-partial`。

**+1，但只有 1 道题。** n=1 的救回率不能作为转正依据——可能是运气。

## 4. 题目设计（修正后）

题目在 `eval/deep/questions-templates.jsonl`，两类各 3 道，数据全部内联在 prompt 里，判分用 `contains`：

| 题 | 考点 | required | forbidden |
| --- | --- | --- | --- |
| `tpl-ops-01` | 发布卡住时定位首个异常行 + root cause + 选对回滚点 | `09:42:58` / `ImagePullBackOff` / `rollback-18` | — |
| `tpl-ops-02` | 连接池饱和的首次排队时刻 + 缺失索引 + 参数建议 | `07:56:50` / `order_items` / `order_id` | — |
| `tpl-ops-03` | 崩溃循环的根因（错拼指令）+ 修复顺序 + 引入提交 | `nginx` / `gzip_statick` / `9c1f0ab` | — |
| `tpl-browser-01` | 三个同名按钮中挑出可用的那个（另两个 disabled / hidden） | `#open-dialog-primary` / `disabled` / `hidden` / `#submit` | — |
| `tpl-browser-02` | 两个 checkbox 里挑出能解锁按钮的那个 | `#agree-terms` / `#next` / `disabled` | — |
| `tpl-browser-03` | 过期数据与当前数据并存时取当前值 | `#page-3` / `1842.00` / `refunded-partial` | `1000.00` |

`forbidden` 只保留「答错就必然出现」的错值（`1000.00`）。**凡是题目本身说了「不要 X」的，都不能把 X 写进 forbidden**——正确回答必然会提到它。

## 5. 要真正转正，下一步该做什么

缺的不是更多重复，而是**更难的题**：

1. **先验证题目难度**：每道新题必须先跑 `base`，`base` 做对了就说明题目没用，直接弃用。这一轮 ops 3 题就是这么废掉的。
2. **加难度的手段**：增加干扰项数量（本轮的 `hidden` 按钮、过期导出版本就有效）、增加需要多步推理的环节、缩短可用的核对线索。
3. **每模板至少 5–8 道有区分度的题**，才能对「救回率」给出可信区间。
4. **固定判分口径**：`forbidden` 只放错值；否定语境一律不进 forbidden。

## 6. 复现

```bash
# 需要可用的 opencode 凭据（OPENCODE_GO_API_KEY，注意月度配额）
node eval/deep/setup-conditions.mjs \
  --from ~/.dsh/profiles/headless --credentials ~/.dsh/.credentials.yaml \
  --base-home ~/.cache/embody-eval/base-home \
  --plugin-home ~/.cache/embody-eval/plugin-home

# 对照臂
node eval/deep/run.mjs --questions eval/deep/questions-templates.jsonl \
  --condition base --ds-home ~/.cache/embody-eval/base-home \
  --ids tpl-ops-01,tpl-ops-02,tpl-ops-03 --workers 1 \
  --out eval/results/template-hard/base.jsonl

# 模板臂
node scripts/agent-scaffold.mjs --template ops-runbook --out ~/.cache/embody-eval/tpl-ops2 --slug ops-runbook
node eval/deep/run.mjs --questions eval/deep/questions-templates.jsonl \
  --condition scaffold --scaffold-home ~/.cache/embody-eval/tpl-ops2 \
  --ds-home ~/.cache/embody-eval/plugin-home \
  --ids tpl-ops-01,tpl-ops-02,tpl-ops-03 --workers 1 \
  --out eval/results/template-hard/ops-runbook.jsonl
```

原始数据：`eval/results/template-hard/*.jsonl`（含每题的 `answer` 全文，可离线重判）。

## 7. 环境限制

- `opencode-go` 有**月度配额**，本轮用尽后所有运行以 `status: exit-1` + `QUOTA: 429 GoUsageLimitError` 失败，不是模型答错。判分时务必区分 `failed`（运行失败）与 `correct: false`（答错）——本轮第一批 12 次运行就是被这个坑掩盖过一次。
- WSL 的 `/tmp` 会随实例空闲清空，条件目录一律放 `~/.cache/embody-eval`。