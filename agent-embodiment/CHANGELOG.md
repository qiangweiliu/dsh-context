# Changelog

格式参考 Keep a Changelog；版本遵循 SemVer。DSH 兼容版本写在每个条目的 Compatibility 下。

## [0.50.5] - 2026-11-17

### Fixed

- **脚手架路径守卫误伤 8.3 短名路径（真实用户可见缺陷）。** 0.50.4 新加的 `unit-windows` job 第一次跑就红了，定位到 `test/routes-scaffold.mjs` 的「临时目录放行」断言失败。真因：守卫里有一条「8.3 短名（`PROGRA~1`、`RUNNER~1`）一律按受保护处理」的规则，而 GitHub Windows runner 的 `tmpdir()` 正是 `C:\Users\RUNNER~1\AppData\Local\Temp` —— 于是「生成到临时目录」被判 400。

  这不是 CI 特例：**长用户名下的 Windows 用户，`%TEMP%` 本身就是短名路径**，他们做脚手架会莫名失败，且错误信息只说「目录受保护」。

  修法：先把路径中**已存在的那一段**用 `realpathSync.native` 展开成长名（目标目录通常还不存在，所以从目标往上找第一个存在的祖先，再把剩余段接回去），然后才做所有比较：
  - 展开成功 → 正常放行（顺带解开中间的 junction / 符号链接，链接指向系统目录时照样判受保护）；
  - **展开失败或展开后仍带 `~N`** → 仍按受保护处理。安全语义没放松：无法确定真实目录就不放行。

### Tests

- `routes-scaffold` 17 → **21**：短名可展开时放行、展不开时仍拒绝、展开到系统目录仍拒绝、展开到 home 下仍拒绝。用注入的 `expand` 覆盖确定行为，另用本机真实 `C:\PROGRA~1` 手工验证过走的是文件系统而不是字符串替换。
- 单元 932 → **936**；集成 181 不变；lint 0。

### Notes

- 这次定位没有依赖 job 日志（未鉴权拿不到），而是两步间接取证：先把 `npm test` 拆成逐文件 step（失败 step 名 = 文件名），再把断言失败输出成 GitHub annotation（通过 `check_run_url` 可读）。两条都是可复用的排查手段。

## [0.50.4] - 2026-11-17

### Added

- **CI 增加 `unit-windows` job**（`windows-latest`，Node 22）。这个插件的主要运行环境是 Windows 桌面版 DSH，但此前 CI 只在 ubuntu 上跑，平台差异（路径分隔符、大小写、进程权限、换行符）全靠每次手工验。现在 `node --check` + 单元套件 + lint 在 Windows 上自动跑；集成 job 仍只在 ubuntu（那套需要本机 `app.asar`，CI 里没有）。
- Windows job 里加了一条**换行符守卫**：`client-build` 是字节级比对，检出时若被转成 CRLF 会红得莫名其妙。`.gitattributes` 已强制 `eol=lf`，这里用 node 显式断言一次，出问题能立刻定位到换行而不是去猜构建脚本。

### Notes

- 只跑 Node 22 而不是三档：平台相关的坑与 Node 版本基本无关，三档一起跑意义不大、还费额度。
- 命令统一用 `shell: bash`（runner 自带 Git Bash），与 ubuntu job 语义一致，避免 PowerShell 对 `&&` 与引号的处理差异。

## [0.50.3] - 2026-11-17

### Added

- **`scripts/deploy-plugin.sh`**：把「同步到已安装副本」固化成一条命令，不再每轮临时写。默认演练（`--apply` 才真拷），排除项（`test/deps` / `node_modules` / `.git`）只写一处供两侧共用；`--check` 拷完跑 `node --check` 并打印两侧版本；`--wsl-only` / `--windows-only` 可分开跑。Windows 用户目录**按目录特征探测**（`Desktop/context/agent-embodiment`），不靠 `$USER` 猜——WSL 用户名和 Windows 账户名经常不同，第一版就猜错成了 `/mnt/c/Users/wu`。

### Fixed

- **`/status/skills/body` 补 `scopeApplied`**：列表响应一直有这个字段，正文没有。前端要判断「这次的视角是否完整」时，两张卡片得用两套逻辑。现在两条路由一致。
- **`docs-guard` 覆盖另外三份版本副本**：以前只断言 6 处，`CHANGELOG` / `RELEASE-PLAN` / `EVIDENCE` 全靠手工同步。加了三断言：CHANGELOG 顶部条目版本、RELEASE-PLAN「当前版本」行的版本区间必须包含当前版本、EVIDENCE 记录当前版本。**加完立刻抓到一处真滞后**：`RELEASE-PLAN` 里标着「当前版本」的行还停在 `0.34.0–0.34.1`，实际已经是 0.50.x —— 这正是「文档说当前是 X，代码已经是 Y」那种最误导人的滞后。

### Docs

- `RELEASE-PLAN.md` 补齐 `0.35.0`–`0.50.3` 五行（架构收敛 / 安全审计 / UI 与模板决策 / 技能目录），「当前版本」标记挪到当前行。

### Tests

- `docs-guard` 12 → **15**；`routes-skills` 67 → **68**（正文响应带 `scopeApplied`）。单元 930 → **932**。lint 0。
- 新断言做过**反向验证**：把 RELEASE-PLAN 的当前版本行改回 `0.34.x`，docs-guard 立刻红；还原后恢复全绿。不做这一步的话，一条「永远通过」的断言比没有更糟。

## [0.50.2] - 2026-11-17

### Fixed

- **测试：技能筛选的输入交互补上了。** 0.50.1 记的欠账是「筛选框输入交互没测」，因为要给卡片注入 `query` 得先数出面板用了多少个 hook。改法是把 mock React 的 hook 状态**按组件隔离**（真实 React 就是每个组件一份 hook 链表）：
  - `makeReact(initialStates, componentStates)`：顶层仍用数字下标（旧调用照旧），组件级用 `{ SkillsCard: { 3: "delta" } }`。
  - `renderDeep` 调用组件前 `__enterComponent(name)`、之后 `__exitComponent()`，组件内 `useState` 序号从 0 起。
  - 好处：**面板结构变了也不会失效**——注入的是「卡片第 4 个 `useState`」，不是「整棵树第 37 个 hook」。

### Tests

- `render.mjs` 55 → **61**：空查询 4 行、命中名称只留 1 行、**命中描述也能找到**（证明筛选不只匹配 name）、大小写不敏感、无命中显示空提示、以及「筛选不匹配来源根名」——这条把实现边界钉死了（筛选范围只有 name / description / whenToUse）。
- 单元 924 → **930**；集成 181 不变；lint 0。

### Docs

- `LIMITATIONS.md`：删掉「筛选输入交互未测」的欠账，改为说明卡片的分组/筛选/复制/徽章/来源提示都有行为级测试，并写明筛选范围不含 `source`。
- `CLAUDE.md`：补 per-component 隔离的用法与「不用数 hook」的原因。

## [0.50.1] - 2026-11-16

### Fixed

- **测试基建：`render.mjs` 的 mock 真正渲染子组件了。** 之前它只产出顶层元素树，`h(SkillsCard, …)` 这类**组件元素**从未被调用，所以卡片内部标记（`data-embodiment-skills` 等）永远不出现——上一轮记录的「到不了 Settings 分支」其实是「没渲染子组件」。补了三处：
  - `react.__resetCursor()`：重渲染前把 hook 序号归零。不归零时第二次渲染的 `useState` 会落到新下标，读回的是别的状态（切了 tab 也看不到变化）。
  - `renderTab(tab)`：渲染后点真实 tab 按钮的 `onClick`（`data-embodiment-tab`），再重渲染。走真实交互，不猜槽位、不改产品代码。
  - `renderDeep(node)`：递归调用函数组件与 class 组件的 `render()`（`CardBoundary` 属后者），把整棵子树展开。

### Tests

- `render.mjs` 36 → **55**：新增 Settings 分支的卡片级断言——技能按来源分组（3 组，标题带数量）、8 行各带查看/复制按钮、>6 个技能出现筛选框、`via` 来源提示、`scopeApplied` 时不出「可能不全」、model/user 徽章按 invocation 区分；另外断言 Settings 挂了 `InventoryCard` / `PricingSection` / `DataCard` / `SessionBudgetCard` / `LabsCard`，以及 trend / events 两个 tab 无卡片级报错。
- 单元 905 → **924**；集成 181 不变；lint 0。

### Docs

- `LIMITATIONS.md`：收窄已知缺口——分组/复制/徽章/来源提示现在有行为级测试，**只剩筛选框的输入交互没测**（要测它得能独立挂载卡片，当前 harness 做不到）。
- `CLAUDE.md`：记录这三处 harness 修正，避免以后有人以为 `render.mjs` 能测卡片却没有。

## [0.50.0] - 2026-11-16

### Added

- **技能视角接入 preset 作用域**：面板现在读的是**当前 preset 层**的技能目录（`via: registry` + `scopeApplied: true`），不再只读全局层。

  0.49.0 里注册表在全局层永远是空的——provider 注册在 agent preset 的作用域层，而 `ScopeKey` 是 `@deepseek-ai/dsh-scope` 里 `Symbol('dsh.scope')` 上的模块私有值，插件不 import 任何 npm 包，拿不到它。解法：**符号属性可枚举**，而只有运行在 preset 作用域内的 `control.js` 手里有带 tag 的 ctx —— 它枚举自有 symbol 值作为候选，**用注册表实测「哪个候选能多列出技能」**，验证通过才写进共享 `state.js`，宿主半侧读来传给 `snapshot({ scope })`。候选传错也只是「查不到层」，等同全局（`chainLayers` 是安全的全函数），不会抛错也不会崩。

- **技能卡片体验**：技能超过 6 个时出现筛选框（按名称/描述/`whenToUse` 过滤）、按来源根分组显示（`source · 数量`）、每行「复制路径」按钮。`scopeApplied === false` 时卡片明说「宿主目录里可能还有更多技能没列在这里」。

### Fixed

- 更正 0.49.0 的一个误判：当时我说「preset 配了 `customSkillDirs`，模型能看到 11 个而面板只有 7 个」。实际那是**另一个 preset**（video-production bundle）的配置，当前会话用的 preset 没有它 —— 面板的 7 个是对的。真正的缺陷是「只读全局层（0 个）」，已由作用域接入修掉；`customSkillDirs` 只有在与控制半侧同一个 preset 时才会被看见，这条已写进 `LIMITATIONS.md`。

### Tests

- `routes-skills.mjs` 62 → **67**：有 scope 时传给注册表并标注 `scopeApplied: true`、无 scope 时不传该字段且标注 `false`、正文请求同样带 scope。
- `static.mjs` 121 → **126**：锁住技能卡片的分组标记、筛选框、复制路径按钮、`scopeApplied` 提示文案、复制失败静默。
- 单元 898 → **905**；集成 181 不变；lint 0。
- **如实记录的缺口**：卡片的「分组 / 筛选 / 复制」只有源码断言，没有行为级测试——现有 `render.mjs` 的 mock 到不了 Settings 分支（`tab` 是第一个 `useState`，槽位注入不可靠）。已写进 `LIMITATIONS.md`。

### Docs

- `LIMITATIONS.md` 重写技能一节：三态数据来源（registry+scope / registry 无 scope / 目录扫描）、**视角边界**（展示控制半侧所在 preset，不随会话切换）、扫盘规则、测试缺口。
- `README.md`、`CLAUDE.md` 同步作用域探测的存在与原因。

## [0.49.0] - 2026-11-16

### Added

- **技能目录（只读）**：Settings 分区新增 `SkillsCard`，列出当前工作区可发现的技能，并可展开看 `SKILL.md` 正文。
  - 两个新路由，都套 `authed`、都只读：
    - `GET /status/skills`（`?sessionId=`）→ 技能目录，含 `name` / `description` / `whenToUse` / `source` / `provider` / `path` / `modelInvocable` / `userInvocable`，外加 `counts`、`complete`、`cwd`。
    - `GET /status/skills/body?name=`→ 单个技能正文；非 kebab-case 名字 400、不存在 404、超 200k 字符截断并标 `truncated`。
  - **取数有两条路径，响应用 `via` 如实标注**：先问宿主 `ctx.skills` 注册表（`via: "registry"`，权威，含 runtime 注册与 preset `customSkillDirs`）；注册表在全局层为空时按 provider 的 rank 顺序扫标准根目录（`via: "filesystem"`）。
  - **为什么必须兜底**：技能 provider 注册在 agent preset 的作用域层，而本插件是宿主平面插件——`ScopeKey` 是 `dsh-scope` 的模块私有 Symbol，插件又按「不 import 任何 npm 包」运行，拿不到它，注册表按全局层读出来永远是空的（实测 `total: 0`）。
  - 扫盘与宿主规则一致：只扫根的顶层、目录包 `<name>/SKILL.md` 或扁平 `<name>.md`、同名先到先得（rank 小的赢）、跳过 `.system` 等隐藏项、**跟随符号链接**（悬空链接跳过）。
  - 扫描根由会话的工作目录决定。**不接受任意 `?cwd=`**，避免把只读路由变成「枚举任意目录文件路径」的接口。
  - 展示 `modelInvocable` / `userInvocable` 两个徽章，但**不提供开关**：这两个值来自每个 `SKILL.md` 的 frontmatter，改它等于改文件，属于另一个动作。
  - 8s 超时保护：provider 卡住时返回 500 并写 warn 日志，不让 HTTP 请求无限挂住。

### Tests

- 新增 `test/routes-skills.mjs`（**62 项**）：列表映射与计数、invocation 摊平、cwd 解析优先级（sessionId > 默认目录，且忽略请求里的 `?cwd=`）、注册表优先 vs 扫盘兜底的选择与 `via` 标注、provider 抛错 500（不泄漏堆栈）、`complete:false` 透传、GET 方法限制、正文 200/404（两条取数路径分别覆盖）、5 类非法技能名 400、超长正文截断与原始字符数、超时路径；另有纯函数层：frontmatter 解析（含引号、YAML 布尔四种写法、缺 description/非法 name）、根目录 rank 规划、扫盘去重与隐藏项跳过、符号链接目录/悬空链接。
- `static.mjs` 117 → **121**：锁住「`ctx.inject(['skills'],` 存在」「两条技能路由已注册且套 authed」「`routes-skills.js` 不写盘」。
- 单元 833 → **898**；集成 181 不变；lint 0。

### Docs

- `docs/IMPLEMENTATION.md`：路由清单补 `/status/skills` 与 `/status/skills/body`（`docs-guard` 会校验路由清单完整性，漏写会直接失败）。
- `README.md`、`LIMITATIONS.md`、`CLAUDE.md` 同步：说明技能是只读展示、开关由 frontmatter 决定、注册表缺席时的行为。

## [0.48.0] - 2026-11-15

### Changed

- **4 个 `experimental` 模板不再计划转正**（`ops-runbook` / `browser-operator` / `data-analyst` / `support-router`）。标注 `experimental` 本身就是如实的披露，继续用配额追「能不能转正」不划算：两轮任务级对照都没得到区分度——先是不挂模板也全对（题目太易），换成历史上会错的题后修完判分错误仍是两组同分。1.0 门禁也不含「模板必须转正」。
- 模板的**结构校验保留**（`test/templates.mjs`，126 项，进 CI）：它回答「装得上吗」——bundle 合法、skill 能被扫描、frontmatter 完整、无未替换占位、`experimental` 必须带警示。这条不需要模型。

### Removed

- 任务级模板评估的全部工具从 `eval/deep/` 移出并**归档**到 `eval/deep/archive/templates/`：`questions-templates.jsonl`（6 道定向题）、`template-smoke.mjs`（批量冒烟）、`template-conditions.mjs`（隔离环境）、两份实验记录与三份原始结果目录。归档目录里的 `README.md` 写明停掉的理由、保留了什么、以及将来重开时必须先读的两条硬教训。

### Docs

- `docs/LIMITATIONS.md`：明确「这 4 个模板不计划转正」并给出理由与归档位置。
- `README.md`：模板清单处标注「不计划转正」。
- `scaffold.js`：`SCAFFOLD_TEMPLATES` 增加一段说明，写清哪两个可用、其余四个为什么长期停在 `experimental`。
- `eval/deep/README.md`：§7 从「模板冒烟」改写为「只做结构校验」；`setup-conditions.mjs` 头部注释改为指向归档。

### Tests

- 无新增断言；`templates.mjs` 126 项与 `scaffold.mjs` 170 项不受影响。单元 833、集成 181、lint 0。

## [0.47.0] - 2026-11-15

### Added

- **键盘焦点环**：Dock 触发器、余额胶囊与面板内所有可聚焦元素（`button` / `input` / `textarea` / `select` / `a[href]` / `[tabindex]`）现在有 `:focus-visible` 焦点环（`--dsw-alias-brand-primary`，`outline-offset: 2px`）。
  - 行内样式表达不了 CSS 伪类，所以沿用 0.14.19 就有的 `<style>` 注入方式，作用域只匹配本插件自己的 `data-embodiment-*` 标记，不碰宿主样式；`dispose` 时移除。
  - 用 `:focus-visible` 而非 `:focus`：鼠标点击不显示焦点环，只有键盘导航才显示。

### Fixed

- `docs/UI-PROPOSAL.md` §9 的一处自查错误：把 `prefers-reduced-motion` 判成「未做」，其实 v0.14.19 就实现了（在 `apply()` 里注入 `<style>`，文档 §6 第 104 行本来写着）。错因是核对时只 grep 了 `20-styles.js`（样式对象），没看 `90-apply.js`（运行时注入）。

### Docs

- `docs/UI-PROPOSAL.md` §9：P1-5 与 P2 两行更正为「已修 / 已做」，§2 的 14 条问题至此全部落地；新增 §9.5 记录这次自查失败与教训（跨文件的能力要按「能力」查，不能按「文件」查）。

### Tests

- `static.mjs` 113 → **117**：新增 4 项断言锁住这两段样式注入——焦点环存在且作用域限定本插件元素、`prefers-reduced-motion` 生效、两段 `<style>` 都在 `dispose` 时移除。避免「文档说没做、其实早做了」或「加了又静默回退」。
- 单元 829 → **833**；集成 181 不变；lint 0。

## [0.46.0] - 2026-11-15

### Security

**独立审计（全新上下文、未参与实现）发现的 9 条问题全部修复。** 原始报告见 `docs/security-audit-independent-0.45.md`，修复说明见 `docs/security-audit.md` §8。

- **F1（high）YAML 键注入**：MCP `env`/`headers` 的键未校验就写进 bundle patch，可插入 `!!js` 表达式，安装该 bundle 时由 DSH 求值（供应链式 RCE）。修复：`mcpMap` 校验键名；`emitObject` 所有键走 `yamlKey()` 引号化兜底。
- **F2（medium）受保护路径绕过**：原实现是纯字符串前缀比较，`c:\windows\system32`、`C:\WINDOWS`、`\\?\C:\Windows`、`C:\PROGRA~1` 均返回「不受保护」。修复：归一化（去设备前缀 / Windows 转小写 / 去尾分隔符）、8.3 短名一律视为受保护、目标已存在时按 `realpath` 再判一次。
- **F3（medium）analytics 缓存无上界**：以原始 `?range=` 为键，无淘汰。修复：`normalizeRange()` 白名单 + 缓存上限 8 条。
- **F4（medium）提示词文本无上限**：整份状态文件每次重写并按份备份（×30 放大）。修复：全局与会话两处都加 32KB 单条上限。
- **F5（low）全局工具开关绕过写队列**：并发写互相覆盖。修复：统一走 `queuePromptWrite`。
- **F6（low）`atomicWriteFile` 未 fsync**：掉电后可能看到空/半截文件。修复：文件与目录都 `fsyncSync`。
- **F7（low）`?range=` 原值进下载文件名**：修复为只用归一化后的 `rangeKey`。**顺带修掉一个真实 bug**：`payload.range` 被 `...summary` 覆盖成区间对象，生产环境导出文件名实际是 `[object Object]`（旧测试用假数据掩盖了）。
- **F8（low）`name` 可含换行**：能往 AGENTS.snippet.md 插标题结构。修复：`normalizeName` 去控制字符并压空白。
- **F9（low）`configEditor.edit` 猴子补丁不还原**：卸载后仍给每次 edit 多做备份。修复：dispose 时还原原方法。

### Docs

- `docs/security-audit.md` 新增 §8，并**更正前文 4 处不成立结论**（fail-closed 行为、写路径范围、MCP 求值面、原子写强度）。§7 列为 1.0 门禁的「仍无独立第三方安全审查」至此关闭。
- `eval/deep/TEMPLATE-PROMOTION.md`（新增）：`ops-runbook` / `browser-operator` 的转正评估。**两个模板都判不转正**，并记录了本轮出题与判分的 4 个错误。

### Tests

- 新增 `test/security.mjs`（**21 项**）：把 F1–F9 逐条固定成回归断言——YAML 键注入被拒且合法键仍可用、路径 8 类绕过全被拦、乱传 `range` 撑不爆缓存、两处文本上限、写队列、fsync、猴子补丁可还原。
- 单元 807 → **829**；集成 181 不变；lint 0。

### 模板转正（负结果，已在 TEMPLATE-PROMOTION.md 详述）

- 按模板定位新出 6 道定向题（运维 3 + 浏览器 3），判分用 `contains`。
- 第一轮结论「ops-runbook 回归」**是我的判分 bug**：`forbidden` 用裸关键词，把「No reboot」这种正确否定判成违规；另有两个 gold 时间戳取错、一个参数题有多个合理答案。
- 修正后离线重判（答案全文存在 jsonl 里，不需要重跑）：ops 两组都是 **3/3**（无区分度），浏览器 `base` **2/3** → `browser-operator` **3/3**（救回 1 道，n=1 不足以转正）。
- 结论：两个模板继续标 `experimental`。缺的是更难的题，不是更多重复。

### 环境限制

- 评估途中 `opencode-go` 月度配额用尽（`GoUsageLimitError`，`resets in 3d 23h`），后续运行以 `status: exit-1` 失败。判分时必须区分 `failed`（运行失败）与 `correct: false`（答错）——本轮第一批 12 次运行曾被这个坑掩盖过一次。

## [0.45.0] - 2026-11-15

### Docs

- **`docs/UI-PROPOSAL.md` 与实现对齐**（此前是唯一还停在旧版本的设计文档）。新增 §9「与实现的核对」：
  - §9.1 逐项核对 §2 的 14 条问题（4 个 P0 / 6 个 P1 / 4 个 P2）：**12 条已修**，只剩 `:focus-visible` 焦点环（P1-5 部分）与 `prefers-reduced-motion` 两项未做。
  - §9.2 核对 §8.2 的 8 个模块全部存在，并补登记此后新增的 12 个模块（`ControlSection`、`ConfigSection`、`BalanceDisplayCard`、`SessionBudgetCard`、`LabsCard`、`OnboardingReopen`、`KpiBand`、`BillingCard`、`DailyChart`、`SessionCards`、`TrendCard`、`EventsCard`）。
  - §9.3 洞察从「6 条带跳转」更新为「11 条、展示上限 10 条、其中 3 条可一键处理」。
  - §9.4 说明核对方式，并注明 §2 的截图证据已过时。

### Tests

- `static.mjs` 新增 `UI-PROPOSAL 登记的组件都存在于 client.js`：解析文档表格里的反引号组件名，逐个断言 `client.js` 里存在同名组件函数。文档写了代码没做、或代码新增了没登记，都会在这里失败——防止文档再次静默漂移。
- 单元 806 → **807**（static 112→113）；集成 181 不变；lint 0。

## [0.44.0] - 2026-11-15

### Added

- **`test/templates.mjs`：6 个模板的 bundle 结构离线校验（126 项，进 CI）**。不调用模型，回答「这个模板现在能不能交给人用」：
  - 元数据：6 个模板齐全、4 个 experimental 标记正确、`id/name/description` 完整、`getTemplate` 可按 id 取回。
  - 生成物（每个模板都验）：`package.json` 合法 JSON 且名字含 slug、patch 里 insert 的是本 preset、`SENSES/HANDS/LOOP/AGENTS.snippet` 非空且无未替换 `{{占位}}`、至少一个 skill 且目录名带 `<slug>-` 前缀、每个 `SKILL.md` frontmatter 有 `name`/`description`、`evals/cases.jsonl` 每行合法且带 `id/task/expect`、`evals/run.mjs` 存在、`embodiment.json` 可解析、安装命令含 slug、experimental 必须带警示。
  - 一致性：同输入两次生成字节一致（防止模板里混进时间戳/随机量）；未知模板仍按既有契约抛错并列出可选模板。
- `eval/deep/README.md` 增加「模板冒烟」一节：离线校验 + 真跑命令 + 凭据限制说明。

### Tests

- 单元 680 → **806**（新增 templates 126）；集成 181 不变；lint 0。

## [0.43.0] - 2026-11-15

### Added

- **洞察一键处理**：`insights.js` 的规则除 `action`（跳转）外可带 `apply: { path, body, label }`，面板在对应洞察行渲染第二个按钮，点击直接写配置并刷新。首批三条：
  - `near-limit-not-compacted` → `POST /status/config/preset {enable:true}`（启用控制行让压缩生效）
  - `budget-unconfirmed` → `POST /status/onboarding {budgetConfirmed:true}`
  - `analytics-truncated` → `POST /status/config {analyticsLimit:200}`
- 新增 `eval/deep/template-smoke.mjs`：为指定模板生成脚手架并跑固定 3 题（`--ids` 可换），输出 `SUMMARY.md` / `summary.json`。用于给 experimental 模板一个最低限度的可用性信号。

### Changed

- **inventory 路由组外置到 `routes-inventory.js`**：读取装配清单、按会话/全局开关工具与提示词、重置、提示词文本编辑，以及 `withLivePromptState`（把落盘覆盖叠加到装配快照上）。`index.js` 1787 → **1681 行**。

### Tests

- `insights.mjs` 29 → **34**（锁定 `apply` 契约：三条规则各自的目标路径与 body、全部指向 `/status/`、都带本地化 label）；`static.mjs` 111 → **112**（inventory 外置契约 + 全局工具重置断言移到新文件）。
- 单元 673 → **680**；集成 181 不变；lint 0。

### 未完成（环境限制）

- 模板冒烟在本机无法产生有效结果：headless profile 走 `llm-deepseek` provider，需要 `DEEPSEEK_API_KEY`，而本机只配置了桌面用的 `llm-pi-ai` 路由（账号凭据），12 次运行全部在 2–5 秒内 `MISSING_CREDENTIAL` 退出。脚手架已改到持久目录（`~/.cache/embody-eval`），脚本可用，缺的只是模型凭据。

## [0.42.0] - 2026-11-15

### Changed

- **`control.js` 拆分第二刀：提示词装配外置为 `prompt-assembly.js`**。`syncGates` 里其实藏着两件事——工具门禁同步（短）与 `system-prompt/assemble` 的 86 行 section 重建 hook（长）。后者在给出「assembly + 各类开关/覆盖」后完全可纯函数化，因此抽为 `buildAssembledSections(input)`。
  - `control.js` 640 → **575 行**；assemble hook 从 86 行降到 20 行，只负责取数与写回。
  - 语义逐字保留：禁用 section 剔除（含 extra 的旧前缀 `ctx-mon-and-con:extra:` 双向匹配）、会话覆盖优先于全局覆盖、frozen section 重建而不就地改、extra prompt 的 system/user 两种落点（system 插在 `harness:identity` 之后）、空文本/非字符串/同名去重、inventory 的 `tokens = ceil(len/4)` 与 `overridden`/`globalOverridden`/`sessionOverridden` 标记、tools 的 token 估算。

### Added

- **`test/prompt-assembly.mjs`（28 项）**：覆盖默认重建、frozen section 不被就地改、禁用剔除、全局覆盖与**会话覆盖优先**、`originalText` 保留、普通对象形式的 `sessionTexts`、`interpolate` 保留与不凭空增加、extra prompt 的 system/user 落点、空文本/非字符串/同名跳过、旧前缀禁用匹配、无 identity 时追加末尾、tools 字段与 token 估算、空输入不抛错。
- `static.mjs` 增加契约断言：`control.js` 必须调用 `buildAssembledSections` 且不再内联 `const inventory = []`——防止装配逻辑被复制回去。

### Tests

- 单元 644 → **673**（新增 prompt-assembly 28、static 110→111）；集成 181 不变；lint 0。

### 剩余（`control.js`）

- 还有两处大块与 Cordis 绑定较深：`syncGates` 的门禁同步（`agent.ctx.tools.restrict` + `agentGates` 生命周期）与两个 inventory `sub.effect`。这两块的测试需要假 agent context，成本高于收益，暂留。

## [0.41.0] - 2026-11-15

### Changed

- **`control.js` 拆分第一刀：压缩范围规划外置为 `compaction-plan.js`**。`planRegion` 原本 55 行、依赖 `config` 与 `getDefaultKeepTokens()`；其中唯一的外部调用是 `agent.session.eventAt(seq)` 取事件类型，改为注入 `typeOf` 后整段变成纯函数。
  - `control.js` 674 → **640 行**；`planRegion` 只剩 18 行适配层（agent → 纯数据）。
  - 阈值语义逐字保留：`keepTokens` > `defaultKeepTokens` > `budget×25%` 三级取值、不动区 reserve 从尾部累加、`cut` 至少 2 个节点、`selectedTokens` 需 ≥ `max(200, min(keepFloor, needed))`。

### Added

- **`test/compaction-plan.mjs`（17 项）**：这是本轮最实质的收益——压缩选段逻辑以前只能「构造真实会话再观察压缩结果」，现在可以穷举边界：消息节点不足 2 条、第 0 个节点始终跳过、`tool/call` 被过滤而 `tool/result` 可压、三级 keepFloor 优先级、保留区凑不够 → null、候选不足 → null、按 `needed` 定位切点、可压不足时压到上限、切点至少 2 节点、所选 token 低于门槛 → null、`heuristicTokens` 回落、返回首尾 seq 与 token 数、非法输入不抛错。

### 评估（`control.js` 后续切法）

- `apply()` 525 行里只有 211 行是具名单元，其余是**内联事件处理器**，所以不能按「函数」切，得按「订阅职责」切。
- 已识别的段：`system-prompt/assemble`（86 行）、两个 `sub.effect` 各约 70 行（inventory 侧）、三个 `agent/pre-step`（41/68/29 行）、`syncGates`（108 行，依赖 5 个闭包）。
- 下一刀建议顺序：① `syncGates` 的门禁合并（纯逻辑最多）→ ② `assemble` 的 section 重建（收益最大但 control 测试只有 55 项，需先补断言）→ ③ inventory 注册（Cordis 绑定深，最后再说）。

### Tests

- 单元 627 → **644**（新增 compaction-plan 17）；集成 181 不变；lint 0。

## [0.40.0] - 2026-11-15

### Changed

- **`status` / `live` / `export` 三条路由外置到 `routes-status.js`**（P1.4 最后一块）。`apply()` 里不再有任何 HTTP handler 实现，只剩依赖装配与路由注册；`index.js` **1964 → 1787 行**（起点 2157，累计减 370 行）。
  - 依赖全部显式注入：`runtime`、`getConfig`、`getMeasurements`、`controlSnapshot`、`getCompacting`、`measure`、`budgetFor`、`breakdownOf`、`analyticsPayload`、`csvCell` / `csvDocument`、`statusCacheMs` 与一组常量。
  - 缓存条件逐字保留：`?fresh=1` 绕过、`revision` 一致、`Date.now() - at < STATUS_CACHE_MS`；响应头（`no-store`、导出 `filename`）与 CSV 列顺序也未变。
  - `status` 里的 `profile` 改从 `runtime.paths.profileName` 取；`onboarding` 从 `runtime.getOnboarding()` 取并叠加 `budgetTokens`。

### Added

- **`test/routes-status.mjs`（24 项）**：以前只能「起完整宿主再观察」的行为，现在可直接断言——
  - status：payload 结构（plugin/version/profile/budget 来源/health/pricing.holidays/sessionBudgets/configEditable）、缓存命中（不重复构建）、`?fresh=1` 绕过、**revision 变化后失效**、`TTL=0` 时每次重建、已有缓存直接返回。
  - live：未知 session 与无会话都 404、`used`/`budget`/`ratio` 计算、`tokenMeter` 抛错时降级为 `used: null` 而非 500。
  - export：JSON 附件名、CSV 带 BOM 且列顺序固定、**公式注入中和**（`=cmd` 变成 `'=cmd`）、analytics 的 503 原样透出、POST 405。

### Tests

- 单元 601 → **627**（新增 routes-status 24、static 108→110）；集成 181 不变；lint 0。

## [0.39.0] - 2026-11-15

### Changed

- **跨会话分析外置到 `analytics.js`**（搬 `statusHandler` 前的必要一步）：
  - 纯函数导出：`parseRange`、`sessionTimestamp`、`sessionsNewestFirst`、`savingsFromLogs`、`ANALYTICS_CACHE_TTL_MS`。
  - 编排走 `createAnalytics({ getSessionQuery, foldFor, summarizeFolds, readCompactionLog, getPricing, getLimit, readWithTimeout, mapLimit })`，`(range, limit)` 短 TTL 缓存与「折叠失败只记告警」的逻辑原样保留。
  - `index.js` 只剩 `foldFor` 注入与一行 `const analyticsPayload = (url) => ANALYTICS.payload(url)`；`sessionTimestamp` 的取值优先级（`lastActivityAt` > `updatedAt` > `createdAt`，兼容 `record.session.header`）逐字保留——这一条如果搬错会静默改变会话排序。
- 修掉 0.38.0 迁移时误改的两条错误文案：`sessionQuery unavailable in this host` 与 `sessionQuery.observeSession unavailable` 曾被替换成 `RUNTIME.getSessionQuery()…`，用户会在面板上看到内部变量名。

### Added

- **`test/analytics.mjs`（27 项）**：区间解析、时间戳优先级与两种 record 形状、倒序且不改入参、节省估算的过滤口径（只算成功且 within range、只累加 before>after）、缓存命中（同 range+limit 不重复 listSessions）、不同 limit 视为不同键、`clearCache` 后重新拉取、limit 上限夹到 200、`limit=0` 回落配置、折叠失败只留告警且最多 5 条、无 `sessionQuery` 抛 503。

### 观察（未改行为）

- `payload.range` 实际是 `summarizeFolds` 返回的区间对象（`{ start, days }`），因为展开 `...summary` 发生在赋值之后；请求参数字符串只体现在缓存键与 `?range=` 里。这是既有行为，本轮按「零行为变化」保留，已在测试里固定，避免以后误以为是字符串。

### Tests

- 单元 573 → **601**（新增 analytics 27、static 107→108）；集成 181 不变；lint 0。

## [0.38.0] - 2026-11-15

### Added

- **`runtime.js`：宿主平面运行时上下文**（为拆 `statusHandler` 铺路）。集中持有：
  - 6 个晚绑定服务句柄（`sessions` / `sessionQuery` / `connection` / `configEditor` / `sessionProjections` / webServer 在位标记）
  - 状态缓存 + revision（`readStatusCache` / `writeStatusCache` / `bumpStatusRevision`）
  - 运行时提示词与工具状态（`promptOverrides` / `extraPrompts` / `placements` / `disabledTools`，初值来自 config 且做浅拷贝）
  - 首次运行引导对象引用，以及路径（`stateDir` / `backupDir` / 三个状态文件，`Object.freeze`）
  - 两个串行写入队列（`enqueuePromptWrite` / `enqueuePresetWrite`，失败只抛给调用方、不阻塞后续任务）

### Changed

- `index.js` 的 **200+ 个状态引用点**统一改走 `runtime.getX()/setX()`：删除 15 个模块级 `let`，路径常量改为 `runtime.paths.*` 的只读别名。
- `onboarding` 从「整体重新赋值」改为「对象身份不变、就地 `Object.assign`」，这样 runtime 可以安全持有引用（避免构造顺序问题）。
- 行为未变：control 55 / smoke 115 / prompt-state 11 全绿。

### Tests

- **`test/runtime.mjs`（35 项）**：路径派生与冻结、服务句柄默认 null 与 `set(undefined)` 归一化、webServer 标记只认 `true`、revision 累加与缓存往返、运行时提示词的浅拷贝语义（外部改动不回流）、`set(null)` 归一化、onboarding 引用语义、两个队列的串行顺序与「失败不阻塞后续」。
- `static.mjs` 增加 runtime 契约断言：`ctx.inject` 里不得出现 `RUNTIME`（本轮踩过的坑：替换曾把服务名字符串一起改掉，导致注入不触发、状态路由 403）。
- 单元 537 → **573**；集成 181 不变；lint 0。

## [0.37.0] - 2026-11-15

### Changed

- **`apply()` 拆薄第二块**：会话预算 / 数据清理 / 会话级提示词文本 / 新增提示词共 6 条路由移入 `routes-session.js`，以 `createSessionRoutes({…})` 注入 18 个具名依赖（`state` 函数、`atomicWriteFile`、以及 `getExtraPrompts` / `getExtraPromptPlacements` / `writeExtraPrompts` 这组 getter + writer）。
  - `index.js` 2032 → **1964 行**（累计从 2157 减到 1964）；行为逐字未变，control 55 / smoke 115 / prompt-state 11 全绿。
  - extraPrompt 的两个 handler 原本直接读闭包里的 `runtimeExtraPrompts` / `runtimeExtraPromptPlacements`；改为 getter 注入后语义不变（写回仍由 `writeExtraPrompts` 统一维护）。

### Added

- **`test/routes-session.mjs`（28 项）**：不需要 Cordis 就能测的分支——`session-budget`（数组 body 400、缺 id 400、非正整数 400、设置 202 且进覆盖表、清除 202 且幂等、revision 递增、GET 405）、`data/reset`（非法 scope 400、logs 只清日志、toggles 落盘、all 两者都做）、`session prompt`（缺 text 400、回落最新会话、显式 id 优先、按 name 清 / 全清、无会话 409）、`extra-prompt`（空文本 / 超长名 / 非法 placement 400、user 位置写入、改回 system 移除 placement、按 name 删 / 全清）。

### Tests

- 单元 509 → **537**（新增 routes-session 28）；集成 181 不变；lint 0。

## [0.36.0] - 2026-11-15

### Changed

- **`index.js::apply()` 开始拆薄（P1.4 步 1）**：脚手架三条路由（`/scaffold/templates`、`/scaffold/preview`、`/scaffold/generate`）与路径守卫 `isProtectedScaffoldPath` 移入新文件 `routes-scaffold.js`，以 `createScaffoldRoutes({ home, dshHome, jsonSender, requireMethod, readJson })` 工厂形式注入依赖。
  - `index.js` 2157 → **2032 行**（`apply()` 1695 → 约 1570 行）；行为逐字未变，靠 control 55 / smoke 115 / prompt-state 11 兜底。
  - 顺带清掉 7 个因搬移而失效的 import（`isAbsolute` / `resolve` / `sep` / `writeFileSync` / `SCAFFOLD_TEMPLATES` / `mergeAgentsContent` / `planScaffold`）。

### Added

- **`test/routes-scaffold.mjs`（17 项）**：第一次出现「不需要 Cordis 就能测 handler」的测试——用假 request/response 直接验证模板列表（6 个模板、实验标记、POST 405）、预览（合法 200 / 未知模板 400）、生成（相对路径 400、home 400、`DSH_HOME` 400、无 overwrite 409、overwrite 202、**真的写盘**、AGENTS.md 幂等 marker）。此前这些分支只能靠启动完整 Cordis + `MockWebServer` 间接覆盖。
- `test/static.mjs` 增加一条抽取契约断言：守卫代码在 `routes-scaffold.js`、`index.js` 通过工厂使用它、且不再自带 `isProtectedScaffoldPath`。

### Tests

- 单元 491 → **509**（static 105→106、新增 routes-scaffold 17）；集成 181 不变；lint 0。

## [0.35.0] - 2026-11-15

### Added

- **`test/docs-guard.mjs`（12 项，已接入 `npm test`）**：断言「同一事实抄了多份」的关键常量是否一致——
  - 版本号：`package.json` ↔ `client.js` / `client-src/00-head.js` 的 `CLIENT_VERSION` ↔ 两份 README ↔ IMPLEMENTATION ↔ CLAUDE 概览
  - 预算回退值：`state.js` 新增 `FALLBACK_BUDGET_TOKENS` 单一定义 ↔ LIMITATIONS / CLAUDE
  - 价格表抓取日期：`metrics.PRICING_UPDATED_AT` ↔ IMPLEMENTATION
  - 路由清单：`index.js` 注册的每条路由都要出现在 IMPLEMENTATION
  - 兼容矩阵：`dsh.compatibility.dshReleases` 每个版本都要出现在 PERMISSIONS
  - 无 runtime dependencies

  首次运行立刻抓到两个真实问题：**CLAUDE 概览的版本号停在 0.29.0**、**IMPLEMENTATION 漏了 `/status/session-budget`**——这正是 0.34.0 那 15 处文档滞后的同一类成因。
- `state.js` 导出 `FALLBACK_BUDGET_TOKENS = 100000`，`budgetFor` 改用它，让「回退预算」只有一个定义可被断言。

### Tests

- 集成 169 → **181**（smoke 103 → 115）：补齐最后 3 条无覆盖路由——`POST /inventory/reset`（非法 layer 400 / 无会话 409 / `layer:session` 202 / `layer:global` 无 `configEditor` 501）、`POST /inventory/prompt/session`（缺 text 400、无会话 409、保存 202 且**真的写进状态**）、`POST /inventory/prompt/session/reset`（按 name 清除、不带 name 全清）。至此 23 条路由**全部有测试引用**。
  期间修掉两处测试自身问题：新块插在 `fiber.dispose()` 之后导致路由已注销；`getSessionPromptTextMap` 返回 `Map` 而非普通对象，断言要用 `.get/.size`。

## [0.34.1] - 2026-11-15

### Docs

- **`RELEASE-PLAN.md` 路线图对齐到 0.34**：原表把 `0.25.0` 标成「当前工作区版本」，实际已到 0.34。补上 `0.26–0.27`（性能/UX 与价格模型）、`0.28–0.29.1`（可维护性 + 不再发布 npm）、`0.30–0.31`（数据正确性与探针）、`0.32–0.33`（隔离与洞察）、`0.34.x`（文档与测试准确性）五行，1.0 门禁补上「独立安全审查」。
- 修正发布门禁里的回滚命令：原写 `dsh plugin add agent-embodiment@0.21.0`，但本项目**不发布 npm**，该命令装不上；改为 `git checkout v0.21.0 -- agent-embodiment` 后按本地路径 `add`。
- **`CORE-FUNCTION-AUDIT.md` 补 0.3 复核小节**：记录 0.26–0.34 的 8 个真实缺陷（面板空白、状态永远 error、HMR 后主区空、写后读旧值、清除预算 400、峰谷价被抹、隔离失效、洞察空白行），每条给根因与守卫测试；P2-6「文档和测试边界滞后」逐项标注已修复/仍存在。

## [0.34.0] - 2026-11-15

### Docs

- **`PERMISSIONS.md` 与 `docs/LIMITATIONS.md` 按 0.33.0 现状复核**（15 处修正），主要滞后项：
  - 状态路径改成 `$DSH_HOME/agent-embodiment/...`，并写明 0.32.0 起跟随 `DSH_HOME`、共享同一 `DSH_HOME` 时会共享状态。
  - 修正「插件不读环境变量」的旧说法：现在会读 `DSH_HOME`（仅用于定位目录）。
  - **修正 403 语义**：原文写「没有 `connection` 服务时不拦截」，实际 0.25.0 起「有 `webServer` 但无 `connection`」一律 403 失败关闭。
  - 补上节假日：费用改为「法定节假日按平档计价，可用 `holidays` 补充」，并说明健康检查的跨年提醒。
  - 补上 `modelPricing` 的 `peak`/`offPeak` 两档（原文仍写「自定义行按全天同价」）。
  - 路由清单、Cordis 服务清单（`sessions` → `sessionQuery`）、`engines.dsh`、`dshReleases`（0.2.2-rc.1 / rc.3 均 `compatible`）同步。
  - 新增披露：`window.__agentEmbodiment` 浏览器侧只读探针（含暴露面评估）。

### Tests

- `test/scaffold.mjs` 146 → 170 项：为 6 个模板各加 4 条**跨文件引用一致性**断言——skill 双份放置数量一致、每个 bundle skill 都有 `.agents` 副本、SENSES/HANDS/LOOP 不引用未挂载的宿主工具、README 只点名已生成的文件。这类断裂（改名漏文件、文档承诺不存在的工具）此前无覆盖。

## [0.33.0] - 2026-11-15

### Added

- **4 条新洞察规则**（共 11 条，卡片上限 7 → 10）：
  - `cache-hit-low`：加权前缀缓存命中 < 30% 且样本 ≥ 20 万 tokens —— 提示系统提示词前缀不稳定（时间戳/会话 id/随机量会让每次请求都 miss 缓存）。
  - `near-limit-not-compacted`：当前会话已到 `errorAt - 5%` 却从未出现在压缩日志里 —— 提示触发线太靠后或控制行没生效。
  - `budget-unconfirmed`：预算从未确认但已有会话 —— 所有比例提醒都建立在默认 128k 上。
  - `analytics-truncated`：`coverage.scanned < coverage.total` —— 结论只覆盖最近一部分会话。
- 补齐 `pricing-stale` 在面板上的文案分支（此前 id 有、文案空，卡片会出现空白行）；新增 5 个词典键（en/zh）。

### Docs

- `docs/security-audit.md` 增加 **0.32.0 增量复核**：新写路由 `session-budget`、`holidays` 配置面、`modelPricing` 峰谷两档、`window.__agentEmbodiment` 探针（新增浏览器可读面，已评估等价于版本号）、`DSH_HOME` 状态目录、脚手架守卫同源、导出二次确认、`?fresh=1` 回读，以及三条剩余风险。

### Tests

- 单元 455（insights 20→29：4 条新规则的触发/不触发、卡片上限 10）。

## [0.32.0] - 2026-11-15

### Fixed

- **状态目录与 profile 识别忽略 `DSH_HOME`**：`index.js` 用 `join(homedir(), '.dsh', ...)` 硬拼路径，所以在「隔离实例」（`DSH_HOME=/tmp/x dsh --profile y`）里会去读真实 `~/.dsh/profiles`、把状态写进真实 home，并把 `profile` 字段报成真实 home 里的那个 profile。0.29.0 的 `0.2.2-rc.1` 隔离验收里 `profile` 返回 `web` 而不是 `rc1` 就是这个原因——当时的「隔离」其实并不隔离。
  - `profile.js` 新增 `resolveStateRoots({ home, dshHome })`：`DSH_HOME` 优先，返回 `{ home, dshHome, stateBase, legacyState, profilesRoot }`。
  - `index.js` 的状态目录、legacy 目录、profile 识别根、脚手架路径守卫统一走它（守卫原本已尊重 `DSH_HOME`，现在与状态目录同源）。

### Changed

- 测试隔离补一条硬要求：`smoke.mjs` / `prompt-state.mjs` 在改 `HOME` 之外还要 `delete process.env.DSH_HOME`——否则 0.32.0 起会把状态写进真实 dsh home（本机 CI 环境里 `DSH_HOME` 是设着的，这一条不补就会挂）。

### Tests

- 单元 446（profile 11→18：`resolveStateRoots` 默认/覆盖、`legacy` 名保持、端到端「真实 home 识别 web / 隔离 DSH_HOME 识别 rc1」）。

## [0.31.0] - 2026-11-15

### Added

- **节假日覆盖健康检查**：`holidayInfo()` 增加 `builtinYears` / `years`，新增 `beijingYear()`；`buildHealth()` 在传入节假日信息时加一项 `holidays` 检查——内置表没覆盖当前年份就提示「补 `config.holidays`」，避免跨年后节假日被按工作日静默计价。该检查与 `measurement` 同属**软提醒**，不改变整体 `healthy`，否则每年元旦面板都会报异常。
- 设置页的节假日只读行补一句指引（`pricingHolidaysWhere`）：告诉用户去 `cordis.patch.yml` 的插件 config 改 `holidays`；健康检查列表新增本地化标签 `healthHolidays`。

### Changed

- **清理 33 个死词典键**（en/zh 各 33 行，共 66 行）：`ctxBrand`、`budget`、`triggerAt`、`preview*`、`undo*`、`notify*`、`compare*` 之外的 `topCost`/`toolImpact`/`costLabel` 等。未引用键从 37 → **0**，`client.js` 235.5 KB（-2.7 KB）。
- `SessionCompare` 的对比行改成字面量 `t('compareTokens')` 等，消除「动态 key 被误判为死键」的盲区（这 4 个键确实在用，没删）。

### Tests

- 单元 439（metrics 61→66：节假日年份、`beijingYear`；insights 16→20：未覆盖年份提醒、软提醒不影响 healthy、补充后通过、未传时不产生检查项）。

## [0.30.0] - 2026-11-15

### Fixed

- **面板保存模型价格会抹掉峰谷价**（0.27.0 引入）：价格卡的 `useEffect` 只映射 `match/input/cacheRead/cacheWrite/output`，`peak`/`offPeak` 被丢弃；由于 `POST /config` 整段替换 `modelPricing`，用户在面板点一次「保存」就会把 yml 里配好的峰谷价静默拍平成全天同价。
  - 价格行改为「平档 + 峰谷两档」两组输入框，`pricingDraft()` / `pricingPayload()` 抽出为纯函数并按原样往返；峰谷每档需 input+output 成对填写，只填一半会提示 `pricingBandIncomplete` 而不是静默丢弃；两档都留空即回到全天同价。

### Added

- **Desktop 验收探针**：client 挂载后在 `window.__agentEmbodiment` 写下 `{ version, panelId, slots, mountedAt, helpers }`。Desktop 的 CDP 只有 inspector target、拿不到面板 DOM，从此可用一条 `Runtime.evaluate` 断言「版本 + 是否挂载成功」；`scripts/ui-check-panel.mjs` 已输出 `probe` 字段。

### Tests

- 单元 430（render 29→36：新增 7 项价格往返与探针断言）、集成 **103**（smoke 78→103）。
- 覆盖此前零测试的路由：`GET /export`（JSON / CSV，含 BOM 与缺 `sessionQuery` 时 503 失败关闭）、`POST /config`（无 editor 501 分支 + 有 editor 时 202 且**峰谷两档保留** + `holidays` 校验）、`POST /config/preset`、`POST /data/reset`、`POST /onboarding`、`POST /inventory/toggle`（含全局提示词开关被拒）、`POST /inventory/prompt/reset`、`POST /inventory/extra-prompt`(+reset)。新增隔离 Cordis 上下文（`MockConfigEditor` + `MockSessionQuery`）专门测成功路径。

## [0.29.1] - 2026-11-15

### Removed

- **不再发布 npm 包**（按项目决定）。分发只走两条路径：awesome-dsh-plugin 市场（`url` 指向本仓库的 `agent-embodiment/` 子目录，pnpm 直接按 git 安装）与从源码 `dsh plugin add <本地路径>`。
- `package.json` 的 `files` 字段移除；`static.mjs` 改为断言运行文件在仓库里真实存在，并明确断言不再声明打包清单。
- CI 移除 `npm pack --dry-run` 门禁；`scripts/wsl-npm-package-test.sh`（打 tarball 安装测试）删除。
- README 删除「从 npm 安装（发布后）」小节；`RELEASE-PLAN` 的发布门禁与状态表、`HANDOFF` 的 npm 小节、`market-submission.md` 的「发布 npm」建议一并改为「已取消」。

### Compatibility

- 运行时与行为无变化：`name` / `version` / `exports` / `engines` / `dsh` 均保留，插件仍通过相对路径被 `dsh plugin add` 与市场安装。

## [0.29.0] - 2026-11-14

### Added

- **节假日表可配置**：新增配置 `holidays`（`YYYY-MM-DD` 数组，最多 400 条）与 `holidaysIgnoreBuiltin`（布尔）。默认与内置表**合并**，跨年只需在 `cordis.patch.yml` 里补新日期，不必改代码发版；`holidaysIgnoreBuiltin: true` 时完全用配置表。重复日期自动去重排序，非法格式在校验层拒绝。
- 状态接口的 `pricing.holidays` 暴露 `{ builtin, custom, ignoreBuiltin, total }`；设置页的模型价格卡只读展示「内置 N 天 + 自定义 M 天 = T 天」，忽略内置时加标注。

### Changed

- `metrics.js` 新增 `configureHolidays()` / `holidayInfo()`；`isPeakTime()` 默认使用「内置 ∪ 配置」的当前集合，逐条成本估算与 `estimateInputCost` 共用同一判定。

### Compatibility

- `0.2.2-rc.1` 由 `unknown` 改为 `compatible`：隔离实例验收（独立 npm 安装目录、独立 `DSH_HOME`、独立 profile、端口 3081）启动成功，状态接口返回 `version: 0.29.0`，面板四 tab 渲染、0 error / 0 exception。

## [0.28.0] - 2026-11-14

### Changed

- **`client.js` 拆分源码 + 轻量构建**：源码按功能拆到 `client-src/`（11 个片段：header / 词典 / 样式 / 核心 / dock / inventory / sections / charts / scaffold / panel / apply），`npm run build:client` 按固定顺序拼回单文件 `client.js`。发布物仍是单文件——DSH 浏览器侧只加载一个 `client.js` 且只能 `require('react')`，没有打包器可用。
- `scripts/bump-version.mjs` 同时改写片段与产物里的 `CLIENT_VERSION`，避免拆开后版本号漂移。

### Added

- `test/client-build.mjs`（6 项）：字节级防漂移——`client.js` 必须等于 `client-src/` 的拼接结果；片段目录里出现未登记进 ORDER 的文件也会失败，并提示跑 `npm run build:client`。
- **写操作统一入口**：新增 `postJson()`，11 处裸 `fetch` 全部收口（inventory 的 7 个写接口、控制行启停、配置保存、定价保存、数据清理、导出重置、脚手架 preview/generate、dock 状态读取）。`fetchJson` 现在会把服务端 `{error}` 文案带进异常，用户看到的是具体原因而不是 `HTTP 400`。
- 写后回读改为 `?fresh=1`，绕过 `/status` 的 800ms 缓存，避免「保存成功但面板还显示旧值」。
- **测试分工收敛**：`static.mjs` 只保留跨文件契约（manifest / exports / 版本副本 / locale / slot 注册形状），并在文件头写明「不要在这里新增源码字符串断言」；`render.mjs` 新增 4 项 dock 行为断言（真执行 `composer.dock` 组件：验证已用比例标记、余额胶囊在无账号时不占位、渲染不抛错），删掉 2 条纯实现细节断言（`viewBox: '0 0 14 14'` 与 `radius = 5.5`）。单元净增 2 项（static 99 / render 29）。

### Compatibility

- 无行为变化：拆分后 `client.js` 与拆分前**逐字节一致**（234,775 字节），面板/路由/数据格式均未改动。

## [0.27.0] - 2026-11-14

### Added

- **本会话预算的面板入口**：设置页新增「本会话预算」卡片（输入 / 保存 / 清除），对应新路由 `POST /status/session-budget`，等价于 `/embody <tokens>` 与 `/embody reset`；无活动会话时只显示说明。清除是幂等的，非法 tokens 或缺 `sessionId` 返回 400。
- **导出二次确认**：JSON / CSV 导出含本机绝对路径（cwd），改为先确认再下载。

### Changed

- **峰谷价按节假日修正**：`isPeakTime()` 增加法定节假日表（`CN_HOLIDAYS`，2026 静态清单），节假日全天不上浮；`isPeakTime(time, holidays)` 可传自定义表。
- **自定义价支持峰谷两档**：`modelPricing` 的行可带 `peak` / `offPeak` 子对象，缺省字段回落平档；`Config` schema 与 `POST /status/config` 两条校验路径都会保留峰谷，不再被拍平。

### Compatibility

- 兼容矩阵未变（`0.2.2-rc.3` 已为 `compatible`）。节假日表是静态数据，跨年需按放假通知更新。

## [0.26.1] - 2026-11-14

### Fixed

- **面板渲染失败（用户实际遇到）**：`SegmentedBar` 的阈值刻度 aria-label 直接调用了 `t()`，但该组件作用域里没有词典函数。空会话走 `MeterBar` 分支所以测不出来，**有真实用量的会话**才抛 `ReferenceError: t is not defined`，整块面板降级。现在词典文案由调用方通过 `tickLabels` 传入，组件不再依赖 `t`。
- **热更新后「侧栏有入口、主区域空白」**：挂载标记原先只存 boolean，HMR 更新 `client.js` 后新 bundle 的 `apply()` 直接返回，新组件没注册、旧注册又被清理。现在标记记录版本号，检测到旧版本时先调用旧 bundle 的 disposer 再重新注册。
- `CtxPage` 外再包一层边界：整体渲染失败时显示「本卡片渲染失败：<原因>」并带重试，而不是空白。

### Changed

- `/status` 增加 800ms 短缓存，但**绑定修订号**：测量、压缩日志、引导状态任一写入都会让缓存立即失效，避免写入后读到旧数据（`?fresh=1` 可强制绕过）。
- 折叠缓存 TTL 从 20s 提到 60s、上限 40→60 个会话；活跃会话仍按 3s 刷新。

### Added

- `test/fetch-chain.mjs`（3 项）：真正执行 `useStatus`/`fetchJson` 的异步链，抓「Response 已解析却再次 `.json()`」这类错误。
- `test/mount-guard.mjs`（7 项）：固定挂载幂等与 HMR 重挂契约。
- `test/locale-keys.mjs`（6 项）：校验 en/zh 词典键一致，且每个 `t('key')` 调用都在词典里。
- `scripts/ui-check-panel.mjs`：按指定窗口尺寸打开 web 实例、点开「上下文」并断言四 tab/内容/无异常的标准检查脚本。
- lint 启用 `no-undef`：变量未定义在 CI 直接失败。

### Compatibility

- 新增 `0.2.2-rc.3` = `compatible`（Windows Desktop 真实安装 + 重启 + 面板确认）；`0.2.2-rc.1` 仍为 `unknown`。

## [0.26.0] - 2026-11-11

### Changed

- **性能**：`/insights` 与 `/analytics` 现在共享同一份 5s 短缓存结果，Overview 打开时不再重复 `listSessions` + 折叠 + 排序；前端 `/live` 增加飞行期去重（CtxPanel 与 CtxDock 不再双拉同一会话），MutationObserver 节流从 2s 放宽到 3s；compaction-log 超限时截到低水位（256KB）而非刚好 400 行，避免在 512KB 边界反复全量读写。
- **首次引导「稍后」语义修正**：此前「稍后」按钮写入 `dismissed:true`（永久关闭），与文案矛盾；现在改为 `deferredAt`（短时不再打扰，之后仍会再出现）。新增 `POST /onboarding { reset:true }` 与设置页的「重新打开设置」入口（`onboardingReopen` 此前已定义但从未渲染）。
- **错误提示人话化**：401/403/5xx 与网络错误映射为可操作文案（附原始信息供诊断），不再只显示 `HTTP 401`。
- **数字口径统一**：`tok` 缩写统一为 `tokens`；头部上下文标注「插件预算」，与「费用（估）」口径一致。
- **可访问性**：日图/趋势图容器加 `role="img"` + `aria-label`；分段上下文条的警告/超限阈值线补 `aria-label`，消除颜色唯一信号。
- **安全加固**：`metrics.js` 工具名计数改用 `Object.create(null)`（防 `__proto__` 原型污染）；PERMISSIONS 补两条披露（scaffold MCP `command` 不做白名单、导出含本机绝对路径）。

### Compatibility

- 无变化：`0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = unknown。

## [0.25.0] - 2026-11-10

### Changed

- **预算优先级调整**：控制行的 `maxContextTokens > 0` 现在是显式覆盖，优先于宿主全局默认值；此前它只是 `budgetFor` 的 fallback，而宿主默认值恒存在，导致该配置**从不生效**。状态接口的 `budget.source` / `budget.controlTokens` 反映实际来源。
- **状态目录按 profile 隔离**：`~/.dsh/agent-embodiment/profiles/<profile>/`；识别依据是「哪个 profile 的依赖真的指向本插件目录」。识别不出来时沿用旧的共享目录，行为不变；首次进入时把共享目录的状态文件复制过去（不覆盖已有文件）。
- **鉴权失败关闭**：挂了 `webServer` 但没有 `connection` 服务时，状态路由一律 403；纯 headless（没有 webServer）仍放行。此前这种自定义组合下 23 条路由全部裸奔。
- **CSV 导出带 UTF-8 BOM**：Excel/WPS 在中文 Windows 上不再把标题、cwd 里的中文按 ANSI 解析成乱码；公式注入防护不变。
- `docs/` 与 `PERMISSIONS.md` 说清兼容声明口径：`engines.dsh` 只是安装范围，逐版本验证状态看 `dshReleases`（`unknown` 不代表被阻断）。

### Added

- `insights.js` 新增 `pricing-stale` 洞察：价格表超过 30 天未更新就提示（`PRICING_STALE_DAYS`），避免官方调价后费用估算静默偏差。
- `profile.js`（纯函数）+ `test/profile.mjs`：profile 识别、状态目录计算、旧目录迁移；11 项断言。
- `client.js`：面板卡片级 `ErrorBoundary`（单张卡片渲染失败不再让整块面板变空，带“重试”）与 tab 可访问性（`role=tablist/tab/tabpanel`、`aria-selected`、方向键 / Home / End 切换）。
- `scripts/bench-analytics.mjs`：analytics 折叠性能基线（P50/P95 与 RSS），结果记入 LIMITATIONS。
- `oxlint` 配置与 `npm run lint`；CI 增加 npm 缓存、`concurrency`、lint 与 `npm ci`。
- 状态接口新增 `profile` 与 `compatibility`（范围 + 逐版本状态）字段。

### Fixed

- **面板整块崩溃（0.24.0 起的真实缺陷）**：`CtxPanel` 里 `analyticsLimit` 引用 `budget` 早于其 `const` 声明，函数作用域的 TDZ 让每次渲染都抛 `ReferenceError`，四个 tab 一起变空；任何卡片级边界都救不了。已把 `data` / `budget` 提到使用点之前。
- 新增 `test/render.mjs`（最小 React mock 真跑面板组件）作为这类问题的回归测试；此前 static/smoke 只做源码字符串断言，全绿也发现不了。
- `test/prompt-state.mjs` 补 `MockConnection`：真实 web profile 一定有 connection，测试桩缺少它会让状态路由按 0.25.0 的新规则返回 403。
- `scripts/wsl-verify.sh` 默认改为 dry-run：只同步副本 + 跑测试；`--apply` 才执行安装、`pkill` 与启动，避免“只是想验证”却改掉 profile 指向。
- `test/static.mjs` 补 3 条工具链断言（lint 脚本、oxlint 配置、lockfile），`files` 加入 `profile.js`。

### Compatibility

- `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.5` = compatible；`0.2.2-rc.1` = unknown（Desktop 端到端仍未做）。

## [0.24.1] - 2026-11-10

### Fixed

- 状态文件改为原子写（临时文件 + rename）：`session-toggles.json`、`onboarding.json`、压缩日志截断/清空不再可能留下半截 JSON；读取失败时自动回落到最近一份备份（备份文件名在同一毫秒内去重，轮转仍保留 30 份）。
- 跨会话统计的读取超时改为 `AbortSignal` 取消：`observeSession` / `listSessions` 超时会一并中止底层读取，不再只丢弃结果而让会话观察继续运行。
- CSV 导出增加公式注入防护：以 `=`、`+`、`-`、`@`、TAB、CR 开头的文本单元格会加前导 `'`，真实数字保持数值形态；RFC 4180 引号规则不变。

### Added

- `persist.js`：原子写、写前备份、备份读取的独立模块（可单独测试），`test/persist.mjs` 覆盖原子覆盖、备份轮转与损坏回落。
- `scripts/bump-version.mjs`：一次同步 package/client/README/IMPLEMENTATION 的版本号；static 测试新增三处版本一致性断言。
- `screenshots.json`：向插件市场声明详情页截图（仓库内相对路径）。
- `scripts/wsl-verify.sh`：在 WSL 里同步源码、跑单元/集成测试并安装到指定 profile 的一键验证脚本。

### Changed

- `PERMISSIONS.md` 与实现对齐：补充 `sessionQuery.observeSession` 读取的派生字段（标题/cwd/模型/工具/用量）、数据导出字段与公式注入处理；修正 `process.env` 的表述；兼容矩阵补上 `0.2.1-rc.3`。
- 兼容矩阵补 `0.2.1-rc.5`：在 WSL `web` profile 做真实安装 + 启动 + `GET /status` 校验（`version 0.24.1`、`control.active=true`），见 [EVIDENCE E32](docs/EVIDENCE.md)。`0.2.2-rc.1` 仍为 `unknown`（Desktop 端到端未做）。
- `scripts/wsl-verify.sh` 修复首跑暴露的三处缺陷：`LOCALAPPDATA` 未绑定导致中途退出、单元套件在独立安装副本里因缺 `../../README.md` 失败（改为在仓库检出目录跑）、asar 探测改用 Windows 用户目录通配 + `DSH_ASAR` 优先；安装后打印实际链接目标与回滚命令。
- 插件 README 增加安装 / 升级 / 回滚章节（npm 发布前使用源码路径安装）。

## [0.24.0] - 2026-10-25

### Added

- 首次运行设置卡：确认插件预算、选择压缩策略、显式授权是否写入控制行；可以跳过，预算与策略之后仍可修改。
- 健康检查（控制行 / 可写入配置 / 预算已确认 / 已有测量），控制行缺失且可写时提供一键修复。
- 面板提醒条与 dock `⚠`：上下文达到警告/超限线、控制行未挂载、最近一次压缩失败；可在设置中关闭。
- 可执行洞察卡：工具定义占比、从未使用的工具、单会话反复压缩、压缩失败、未知模型价格、费用异常会话，每条可跳到对应位置。
- 压缩节省估算：按成功压缩的 `before - after` 汇总减少 tokens，并按 V4.1 Flash 输入价折算，明确标注口径。
- 会话对比（并排比较两个会话）与会话按最近活动 / tokens / 费用排序；费用最高会话高亮。
- 设置页模型价格编辑器：增删自定义 `match` 正则与 input/cacheRead/cacheWrite/output 行。
- 数据管理：按当前扫描范围导出 JSON / CSV，分别清空压缩日志、会话开关或两者；清空为两步确认。
- 提示词变更预览与增减 token 估算；工具行显示禁用后影响；保存无变化时按钮禁用。
- 新路由：`/status/insights`、`/status/onboarding`、`/status/export`、`/status/data/reset`。
- `insights.js` 纯规则引擎与 12 条单测；`metrics.js` 增加工具调用计数与 `estimateInputCost`。

### Changed

- 默认触发线从 `1` 改为 `0.9`：`balanced` preset 现在也是 0.9 触发 / 0.6 目标 / 保留 25%，不再等到窗口打满才压缩。
- `autoMountControl` 默认改为 `false`：首次运行必须由用户显式同意，插件不再静默改写 agent preset。
- 左侧导航 `embody` 重命名为 `Context` / `上下文`；Agent 从顶层 tab 移入设置 → Labs，面板固定为概览 / 趋势 / 事件 / 设置四个 tab。
- 跨会话分析显示“已扫描 / 总会话 / 上限”，不再把 `analyticsLimit` 截断后的结果当成全量。
- 概览去掉与页头/dock 重复的上下文大卡、与每日图重复的活跃度热力图，以及重复的费用 KPI；只保留 KPI 带、计费卡、每日图、最近会话。
- 页头合并为“会话 + 已用/剩余（或累计）+ 请求 + 费用”一行，并复用分段构成条；空会话不再显示四个 0% 构成。
- 会话卡从嵌套 button 改为可点击卡片 + 独立“打开会话”按钮。
- 设置页移除重复的“压缩记录”折叠块，压缩/注入历史统一到“事件”页。
- 版本升到 `0.24.0`。

### Fixed

- 会话列表不再依赖 `sessionQuery.listSessions()` / `sessions.list()` 的隐式顺序：显式按活动时间倒序后再取“最近 N 个”/latest。
- 自动挂载只写已知 preset id；找不到标准 preset 时只告警，不再猜一个任意 preset；重新启用时保留控制行原有 `mode` / `cooldownMs` / `maxAttempts` / `keepTokens`。
- 全局工具 toggle / “恢复全部”现在同步 `setGlobalDisabledTools`，重置后控制半侧不再沿用旧的全局禁用。
- 脚手架拒绝任意盘符根和 Windows `SystemRoot` / `ProgramFiles` / `ProgramData` 等系统目录。
- “恢复全部”同时清除会话提示词文本覆盖。
- 页头与会话卡的费用统一标注为“费用（估）”。
- 会话切换时清空上一会话的 `selected` 历史选择，趋势/详情不再停留在旧会话。
- `useLive` 在 path 变化时立即清空旧 payload，并用请求路径守卫丢弃迟到的旧响应；dock 同样按 sessionId 守卫。
- 补上 `sessions` 服务晚注入时的订阅；头部请求数只在 detail 属于当前会话时使用。
- 会话级提示词编辑草稿、展开态和确认态在切换会话时重置，避免把 A 会话的编辑带到 B 会话。
- “打开会话”优先调用官方 `uiWorkspace.openSession`，并补 `role=treeitem` 侧栏回退。
- 提醒条使用 `--dsw-alias-state-warn-primary`，修复无效 token 导致的不可见。

### Tests

- `static 95/95`、`metrics 35/35`、`state 18/18`、`scaffold 146/146`、`insights 12/12`、`control 54/54`、`smoke 72/72`、`prompt-state 11/11`。
- 新增静态断言：会话切换丢弃旧响应、清空历史选择、概览去重、`uiWorkspace.openSession`、会话排序、自动挂载目标、全局工具同步、Windows 路径、费用标签与“恢复全部”文案。
- `state.mjs` 覆盖 `clearSessionToggles` 同时清工具/提示词开关和会话提示词文本；`metrics.mjs` 覆盖工具调用计数与输入费用估算。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`（headless + Web 实测；Desktop 未单独验收）。

## [0.23.0] - 2026-10-24

### Added

- `compressionStrategy` preset：`conservative`（0.9 / 0.7 / 保留 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）；显式 `triggerAt` / `targetAt` / `keepTokens` 优先。
- 设置页增加压缩策略选择；切换策略会同步触发/目标比例。
- `analyticsLimit` 配置（1..200，默认 40），`?limit=` 仍可临时覆盖。
- 控制行未挂载时，工具/提示词修改会显示提示并拒绝执行。
- 计费按 DeepSeek 官方人民币峰谷价换算：V4.1 Flash / V4 Pro 的缓存命中、未命中、输出分开计价，每条请求按北京时间判定高峰/空闲。
- 概览新增计费卡；页头、会话卡、趋势卡与 tooltip 显示人民币费用。
- 静态测试新增压缩策略/control 未挂载提示/dock 已用百分比/趋势图与头部摘要/计费断言。

### Changed

- 版本升到 `0.23.0`。
- 底部 dock 改为跟随内置 ContextMeter 的读法：环形 + “插件上下文已用”百分比（分母仍是插件预算）；弹层显示已用/上限/剩余。
- 面板头部增加会话/预算/已用/剩余/请求数摘要与使用率条；趋势图补纵轴刻度、预算线、输入/输出配色和请求序号，替换原有的黑柱与 T 轮次标签。
- 费用从“只对旧模型按全天同价”改为官方峰谷价逐条估算，概览 KPI 与新增计费卡都读 `kpi.cost/costParts`；自定义 `modelPricing` 仍按全天同价。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`；`0.2.1-rc.3` 已完成 headless + Web 实测并加入矩阵，Desktop 未验收。

## [0.22.0] - 2026-10-24

### Changed

- 底部 token 指示器只显示“插件上下文”上限，不再重复官方 ContextMeter 的用量/构成。
- 脚手架定位改为 experimental 可选；`sense-environment` / `verify-change` 改为 `processSkills: true`（CLI `--process-skills`、面板 checkbox）才生成，默认只生成角色/delegation skill。
- 4 个依赖外部 MCP/知识库的模板标记为 `experimental`。
- 成本估算支持 `modelPricing` 用户价格表。
- `autoMountControl` 写入 preset 后回读校验，失败写 warning。

### Removed

- 生成的 `sense_environment` 工具与 `tool-catalog` skill。
- 底部指示器中重复的圆环/百分比/构成展示。

### Security

- 所有 HTTP 路由统一经过 `ctx.connection.requestRejection`；POST 只接受 `application/json`。
- scaffold `targetDir` 拒绝文件系统根、home 及其祖先、系统目录、`$DSH_HOME` 与常见凭据目录。

### Tests

- `static 77/77`、`metrics 24/24`、`state 16/16`、`scaffold 146/146`、`control 54/54`、`smoke 66/66`、`prompt-state 11/11`。
- Tier B 50 题四组对照与 scaffold 降本复核见仓库 `eval/deep/RESULTS.md`。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`（已实测）；`0.2.1-rc.3` 未验证。

## [0.21.0] - 2026-10-22

### Changed

- 统一命名：市场标题 `Agent Embodiment` / `智能体具身`，包名/目录 `agent-embodiment`，命令短品牌 `/embody`。
- 新增 Agent 脚手架（6 个模板）与面板 Agent tab。
- 旧命令 `/ctx`、`/ctx-compact` 保留为兼容别名；旧状态目录自动迁移。

### Compatibility

- DSH `0.2.0-rc.2`、`0.2.1-rc.2`。
