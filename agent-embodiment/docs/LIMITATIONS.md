# 约束与已知限制

本文记录 `agent-embodiment` 的使用约束、行为边界和未验证项。面向用户的功能说明见 [README.md](../README.md)，实现细节见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。

## 1. 安装、启停与更新

DSH 默认启用 HMR（`dsh-hmr` + `dsh-client-hmr`），因此：

- **首次安装**：`dsh plugin add` 成功后，宿主半侧会在数秒内热挂载；Web 页面会跟随客户端模块图自动出现，**不需要重启 DSH**。实测约 4 秒（见 `EVIDENCE.md` E16）。
- **Desktop**：0.2.1-rc.2 已实测，运行中 add/remove 后侧栏与面板即时出现/消失，不需要重启（`EVIDENCE.md` E17）。
- **启用/停用插件行**：即时生效。
- **刷新页面**：如果页面仍显示旧界面，刷新一次即可重新加载客户端 bundle；这比重启 DSH 更轻。
- **替换已安装包（升级到新版本）**：DSH 会缓存已挂载包的 manifest 与模块代际，官方明确该场景不是热升级路径，**仍需重启 DSH 进程**。
- **宿主没有 HMR**：如果 profile 的自定义 patch 关闭了 `hmr`，运行中的进程不会重新组合，此时安装/卸载才需要重启。
- **卸载**：HMR 会即时卸载 `/embody`（`/ctx` 别名）、`/embody-compact`（`/ctx-compact` 别名）和面板；只有替换/删除宿主模块或没有 HMR 时才需要重启。profile patch 里的残留行仍建议用清理脚本移除。

如果安装后仍未出现，按顺序检查：

1. **profile 是否一致**：Desktop 运行的是 `desktop`，WSL `dsh web` 通常是 `web`。带 `--profile` 安装到另一个 profile 不会出现在当前实例里。
2. **DSH 版本**：已逐版本验证 `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5`（真实安装 + 启动 + 状态接口）；`0.2.2-rc.3` 在 Windows Desktop 上真实安装、重启并点过面板（2026-11-14，0.26.1），标为 `compatible`；`0.2.2-rc.1` 也已做隔离实例验收（独立 npm 安装目录 + 独立 `DSH_HOME` + 独立 profile + 端口 3081，0.29.0 启动成功、面板四 tab、0 异常），标为 `compatible`。**`engines.dsh` 只是安装范围**（`>=0.2.0-rc.2 <0.3.0`），范围满足 ≠ 已验收；兼容状态以上面的逐版本记录和状态接口的 `compatibility` 字段为准。更老的版本或更早的 `0.2.1-rc.1` 不在矩阵内，旧版本也可能没有 `dsh-client-hmr`。
3. **HMR 是否被关闭**：自定义 profile patch 若把 `hmr` 行设为 `disabled: true`，运行中的进程不会重新组合。
4. **是否在替换已安装包**：升级到新版本属于 DSH 的“package replacement”，仍需重启进程；首次安装不受此限制。
5. **页面是否陈旧**：Web 刷新一次即可；Desktop 0.2.1-rc.2 实测无需刷新，若仍未出现再重启应用。

## 2. 上下文与预算的边界

- `contextWindowTokens` 是插件预算，不改变模型真实窗口。
- 底部「插件上下文」百分比的分母是插件预算（含会话级覆盖），不是模型窗口；与内置 ContextMeter 的百分比可能不同。
- 趋势图只取最近 40 次请求；预算离峰值超过 1.6× 时不画预算线，只在右上角显示峰值/预算占比。
- 费用按请求完成时间判定峰谷（北京时间工作日 09:00–12:00、14:00–18:00），**法定节假日按平档计价**：内置 2026 年表可用配置 `holidays`（`YYYY-MM-DD` 数组）补充、`holidaysIgnoreBuiltin` 完全接管；内置表没覆盖当前年份时健康检查会提醒（只提醒，不改变 `healthy`）。Search/Fetch 未计入，缓存写入按未命中价估算，价格随官方调整可能滞后。
- 旧模型名 `deepseek-chat` / `deepseek-reasoner` 沿用旧价，只用于历史会话估算；当前官方 V4.1 Flash / V4 Pro 使用页面抓取的峰谷价。
- 当预算低于「系统提示 + 工具定义」的基础开销时，压缩无法把用量降到目标线以下。
- `warnAt` / `errorAt` 只影响显示颜色，不参与自动压缩。
- 自动压缩依赖 DSH 的 compaction 服务；没有可安全压缩的历史时会跳过。
- **预算优先级**（0.25.0 起）：会话覆盖（`/embody <tokens>`）> 控制行 `maxContextTokens`（>0 时）> 宿主 `contextWindowTokens` > 100000。控制行的值不再被宿主默认值遮蔽；`budget.source` 会显示 `control` 或 `default`。
- **状态目录**：`$DSH_HOME/agent-embodiment/profiles/<profile>/`（0.25.0 起；0.32.0 起跟随 `DSH_HOME`，默认 `~/.dsh`）。识别不出所属 profile 时（例如手工拷贝、路径不是 profile 依赖）退回共享目录 `$DSH_HOME/agent-embodiment/`，此时同机多 profile 仍会共享开关与引导状态。
- **analytics 性能**：纯函数折叠的基线（`node scripts/bench-analytics.mjs`，固定夹具）——40 会话 × 200 事件：P50 6.6ms / P95 12.4ms / RSS 46MB；200 会话 × 400 事件：P50 18.7ms / P95 62.4ms / RSS 85MB。真实宿主还要加读日志的时间（并发 4、TTL 20s），事件数超过约 8 万时单次扫描会进入百毫秒级，面板会明显停顿。

## 3. 工具与提示词清单

- 清单来自最近一次实际请求；新会话第一次请求前为空。
- 清单只存在进程内存，重启后清空，需要重新发消息。
- 提示词 section 的开关只对当前会话生效；切换会话互不影响，开关本身写入 `session-toggles.json`，重启后会恢复。
- 工具支持全局禁用；提示词覆盖和新增提示词才是持久配置。
- 面板里的 token 估算是启发式值，不保证与 provider 统计完全一致。

## 4. 提示词修改的行为边界

- `promptOverrides` 只能覆盖已有 section，不能新增 section。
- `extraPrompts` 才能新增独立 section，且不会覆盖原文。
- 新增提示词可选择追加到系统提示词，或追加到每次用户提问末尾。
- 追加到提问末尾的内容会成为该条 `user/message` 的一部分，在会话历史/UI 中可见，不是隐藏指令。
- 追加只发生在新的用户消息上；工具调用循环、已有历史消息不会被重复追加。
- 提示词修改对之后的请求生效，不会重写已有会话的 system prompt 历史。
- 如果模型继续受旧提示词影响，新建会话是得到干净提示词组合的可靠方式。
- 修改 `AGENTS.md` 等文件不会追溯修改已有会话。

## 5. 自动压缩控制的限制

Web 形态下，宿主自带的 `auto` 压缩行被 `dsh-web-app` 置为 disabled，bundle 层无法按 id 命中。因此：

- 控制半侧必须挂进 agent preset；
- 自动挂载默认关闭（`autoMountControl: false`），首次运行需显式授权；授权后也只写已知 preset id（优先 `preset-standard`），找不到已知 id 时只告警，不会猜一个非标准 preset；
- DSH 升级 preset 后，需要重新启用或手工同步；
- 控制行是否生效以面板「控制」卡状态为准。

## 6. 扫描、洞察与数据管理范围

- 跨会话分析默认只扫描最近 40 个会话（`analyticsLimit`，可配 1..200），不是全量；面板的 `coverage.total / scanned / withData` 会把截断情况直接显示出来。`?limit=` 只能临时覆盖，不会写回配置。
- 会话排序优先使用 `updatedAt`/`lastActivityAt`；provider 只提供 `createdAt` 时退化为创建时间，因此“最近 N 个”在恢复旧会话的场景下可能不是严格按最后活动时间，界面把它标为近似值。
- 费用只对内置价格表覆盖的 DeepSeek 模型估算；未知 provider/模型显示 `—`。自定义价格行默认全天同价，可用 `peak` / `offPeak` 两档显式区分（面板价格卡两组输入框，留空即全天同价）；不会自动跟随官方调价。
- 缓存命中、工具调用、压缩次数来自会话事件折叠，可能受日志完整度影响；工具“从未使用”只在已扫描会话里成立，不代表全局从未调用。
- `unknown-pricing` 只说明“有 token 但算不出费用”，不推断模型一定收费；`cost-outlier` 用中位数 2.5 倍作阈值，只是提示，不是账单异常判定。
- 0.33.0 起新增 `cache-hit-low`（加权缓存命中 < 30% 且样本 ≥ 20 万 tokens）、`near-limit-not-compacted`（已达 `errorAt − 5%` 且该会话从未压缩）、`budget-unconfirmed`（预算未确认但已有会话）、`analytics-truncated`（`coverage.scanned < total`）四条启发式提示；阈值同为经验值，不证明因果。
- `tool-schema-share` 的 50% 与 `repeated-compaction` 的 2 次都是启发式阈值；洞察卡不证明因果，也不自动执行禁用/改配置。
- 节省估算只累加成功压缩的 `before - after`，再按 V4.1 Flash 输入价折算；它不是账单退款，不包含缓存命中差异，也不代表实际少付了同样的钱。
- 趋势和事件页依赖历史会话日志；缺少日志的会话不会出现在统计中。
- `/status/export` 只导出当前 `range` / `limit` 下的分析结果（JSON 含汇总与每日桶；CSV 为会话级字段，含 `title`/`cwd`），不导出消息正文；文件由浏览器下载到本机，插件不上传。
- `/status/data/reset` 只清插件状态：`logs` 清压缩日志，`toggles` 清全部会话工具/提示词开关与会话提示词文本；不清 profile 配置、不清全局工具禁用、不删会话历史。
- 首次运行状态写在 `$DSH_HOME/agent-embodiment/profiles/<profile>/onboarding.json`（完成/跳过、预算确认、preset 授权、版本），不写 profile 配置；删掉该文件会重新出现首次运行卡。
- 勾选“允许写入控制行”只表示授权；实际是否生效仍以控制行是否挂载、`control.active` 为准。跳过向导不会自动挂载。

## 7. 平台与安装

- `desktop` profile 由 Electron 独占，部分 CLI 操作（如 `--dump-config`）不可用。
- 本地目录安装使用 `link:`；Windows 热卸载可能残留 junction，需要脚本清理。
- DSH 升级可能覆盖 preset 或 profile 配置；升级后应重新确认控制行和面板状态。
- 第三方插件不能默认 `import '@deepseek-ai/*'`；本插件因此不 import 宿主包。
- 不要将 `DSH_HOME` 指到插件目录内部，避免 profile 与插件目录互相引用。

## 8. 未验证项

- 未对 DSH `0.2.0-rc.1`、`0.2.1-alpha.*`、`0.1.x` 做运行验证。
- DSH `0.2.1-rc.3` 已做 headless + Web 实测并加入兼容矩阵；Desktop（Electron）尚未在该版本上验收。`0.2.2-rc.1` 走的是隔离实例（独立 npm 目录 + 独立 `DSH_HOME` + 独立 profile + 端口 3081），未在 Desktop Electron 上验收。
- Desktop 插件管理器的部分边界行为与 Web 形态不同，不能完全用 WSL 结果替代。
- 未进行独立安全审计；[PERMISSIONS.md](../PERMISSIONS.md) 只披露访问面，不构成安全认证。
- 自动压缩在高负载/超大历史下的耗时未做系统性压测。
- 新增提示词在 Desktop Electron 中的 UI 交互仍需按实际版本验收。

## 9. Agent 脚手架

- 只写用户提交的**绝对**工作区目录；拒绝文件系统根目录、用户 home 及其祖先、`/etc` 等系统目录、DSH 配置目录和常见凭据目录，默认不覆盖已有文件。
- 生成的是起点模板，不保证直接达到生产质量；必须用真实任务和 eval 继续迭代。
- `ops-runbook`、`browser-operator`、`data-analyst`、`support-router` 标记为 `experimental`，依赖外部 MCP/知识库，尚未做任务验证。**结构校验**只保证生成的 bundle 自洽（YAML 可解析、技能文件齐全、MCP 占位符合法），不代表任务质量。
- **这 4 个模板不计划转正（0.48.0 决定）。** 曾试过任务级对照评估（每题带 `base` 控制臂），两轮都没得到区分度：先是不挂模板也全对（题目太易），换成历史上会错的题后两组分数仍相同。既然标注 `experimental` 已能如实告知「未验证」，就不再用配额去追这个结论。评估工具与数据归档在仓库 `eval/deep/archive/templates/`，重开前先读那里的两条硬教训。
- 生成的 preset 复用 `agent-embodiment/control`；同一 profile 需要安装本插件，否则 preset 激活会失败。
- MCP 行可由用户提交的 JSON 生成（stdio / streamable-http）；插件只写配置，不执行 MCP 命令；secret 用 `${ENV_VAR}`，安装/启用前仍需审查 command/args 与凭据。
- `AGENTS.md` 支持带 marker 的幂等合并（保留用户内容）；不勾选 `writeAgents` 时只生成 `AGENTS.snippet.md`。
- `evals/run.mjs` 只负责按 case 调 `dsh headless` 并记录 transcript，不自动判断正确性；需要人工按 `expect` 审阅。
- 不会自动修改默认 preset；安装后在 Settings → Agent presets 手动选择。
- **子 agent 跨版本差异**：DSH 0.2.1-rc.2 已移除 `dsh-tool-subagent` 的 `persona` / `toolFilter`。生成器只使用跨版本字段，角色说明放在 `delegate-<role>` skill；如果需要子 agent 的工具隔离或独立 persona，应另建 Agent Preset 并用 `agentPreset` 选择。
- 脚手架不是安全沙箱：它只约束写盘路径、覆盖行为和默认 MCP secret 形式，不限制生成后的 agent 工具权限。
- `sense-environment` / `verify-change` 是可选过程 skill（`processSkills: true` / `--process-skills`），默认只生成角色/delegation skill；它们只使用 DSH 原生工具，不再注册自造 `sense_environment` 工具。

## 10. 其他

- 插件的 HTTP 路由先经过 `ctx.connection.requestRejection`（Host/Origin + 浏览器/API 认证）；没有 `connection` 服务时：纯 headless 放行，**有 `webServer` 则一律 403（失败关闭，0.25.0 起）**。POST 只接受 `application/json`。
- 面板挂载后会在本页 `window.__agentEmbodiment` 写一个只读探针（`version` / `panelId` / `slots` / `mountedAt` / 两个价格换算纯函数），供 CDP 与测试断言；同页第三方脚本可读，内容等价于已渲染的版本号，不含会话、token 或路径。
- 上下文上限、提示词覆盖、工具开关的实际执行在 `control.js`（preset 平面）；control 未挂载时这些功能不生效。

### 技能目录（0.49.0 起，只读）

- 面板的「技能」卡片**只展示不修改**：不启用/禁用、不改 `SKILL.md`、不新建或删除技能。
- 技能是否进模型 / 是否可被用户调用，是**文件属性**（`SKILL.md` frontmatter 的 `disable-model-invocation` / `user-invocable`），不是运行时开关。宿主的 `ctx.skills` 注册表没有「按会话过滤」的接口，所以这里不提供开关按钮——硬做只能注册同名 runtime stub 遮蔽 provider 候选，那会让正文也取不到，不是真正的管理。
- 扫描根由会话工作目录决定（`.dsh/skills`、`.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`）。**不接受任意 `?cwd=`**：否则这个只读路由会变成「输入任意路径、返回其中文件的绝对路径」的枚举器。
- **数据来源有三态，卡片会标出**（`via` + `scopeApplied`）：
  - `registry` + scope 已接入：宿主注册表在 **preset 作用域层**读出的目录，权威。含 preset 里配的 `customSkillDirs`。
  - `registry` + scope 未接入：只读到全局层，通常为空——这时会提示「宿主目录里可能还有更多技能没列在这里」。
  - `filesystem`：注册表读不到时按 rank 顺序扫标准根（`via` 标注为「目录扫描」）。只能覆盖那 4 个标准根。
- **视角边界（重要）**：面板展示的是**控制半侧所在 preset** 的技能视角，不是「任意会话」的。若某个会话跑在另一个 preset 上（例如自带 `customSkillDirs` 的 bundle preset），那张卡片不会切换成那个 preset 的目录。要改成「按会话」需要宿主暴露会话 → agent 的映射。
- 扫盘遵循宿主规则：只扫根的**顶层**（不递归找嵌套 `SKILL.md`），目录包用 `<name>/SKILL.md`、扁平用 `<name>.md`，同名按 rank 先到先得，跳过 `.system` 等隐藏项，跟随符号链接（悬空链接跳过）。
- 目录查询有 8s 超时；provider 卡住时返回 500 并写 warn 日志，不会让请求无限挂住。
- `complete: false`（部分 provider 未完成发现）会如实显示为「列表可能不完整」，不当作全量。
- 技能卡片的分组 / 筛选 / 复制路径按钮 / 徽章 / 数据来源提示**都有行为级测试**（`test/render.mjs` 渲染到 Settings、`renderDeep` 展开子组件、按组件名隔离 hook 状态来注入筛选值）。筛选的匹配范围是名称 + 描述 + `whenToUse`，**不包含来源根名**（`source`），这一点有专门断言。
