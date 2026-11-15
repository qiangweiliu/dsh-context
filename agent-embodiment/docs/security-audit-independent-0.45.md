# 独立安全审计（0.45.0 代码状态）

审计日期：2026-11-15　｜　审计对象：`agent-embodiment` 0.45.0　｜　方式：全新上下文的对抗式审计（审计者未参与实现）

本文件保留审计原始结论，修复情况见 `security-audit.md` §8 与 `CHANGELOG.md` 0.46.0。

## 结论

**有条件发布**：23 条路由的鉴权、fail-closed、体积上限、原子写、路径逃逸校验经实测成立；但存在 **1 项高危**（脚手架生成的 bundle patch 可被 YAML 键注入 `!!js` 代码）、**2 项中危**（受保护路径守卫可被大小写/8.3/`\\?\` 绕过；analytics 缓存无上界）。

## 发现

| # | 严重度 | 位置 | 问题 | 攻击路径 | 影响 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | high | `scaffold.js` `mcpMap` / `emitObject` | MCP `env`/`headers` 的**键**未校验就进 YAML，而值是 `!!js` 求值入口 | `planScaffold({... env: {'A: !!js process.exit(1)\n        B': 'v'}})` → 生成的 `dsh.bundle.patch.yml` 出现 `A: !!js process.exit(1)`；用户 `dsh plugin add` 时 DSH 求值 | 供应链式 RCE：贴入不可信 MCP 配置即可把代码写进待安装 bundle（前置：已鉴权 + 用户安装该 bundle） | 校验键名；输出时对键做引号化；`__raw` 只允许白名单来源 |
| F2 | medium | `routes-scaffold.js` `isProtectedScaffoldPath` | 纯字符串前缀比较，未归一大小写、未处理 `\\?\`、未 realpath | 实测 `c:\windows\system32`、`C:\WINDOWS`、`\\?\C:\Windows`、`C:\PROGRA~1` 均返回 false（未受保护）；`c:\users\40410\.ssh` 同样 false | 可把 bundle / AGENTS.md / SKILL.md 写进系统或凭据目录；符号链接可在前缀检查通过后写出 | 归一化比较 + realpath + 8.3 处理；白名单优于黑名单 |
| F3 | medium | `analytics.js` | 缓存以原始 `?range=` 为键，无上限、无淘汰 | 循环请求 `?range=x1..xN` → 每个键永久驻留，每次还触发全量 listSessions + 200 会话折叠 | 鉴权用户即可造成内存单调增长与 CPU/IO 放大 | range 白名单归一化；缓存加 LRU 上界 |
| F4 | medium | `state.js` / `routes-session.js` / `routes-inventory.js` | 提示词文本无长度上限；每次写入整份文件并整份备份（30 份） | 反复 POST 250KB 文本 → 文件线性增长，备份同尺寸 ×30 | 磁盘与写放大 | 单条上限（32KB）；备份去重 |
| F5 | low | `routes-inventory.js` 全局开关 | 全局工具开关绕过 `queuePromptWrite` 直接 `editor.edit` | 与 `/inventory/prompt` 并发请求 → 后写者用旧快照覆盖前者字段 | 设置静默丢失（patch 整段替换） | 统一走写队列 |
| F6 | low | `persist.js` `atomicWriteFile` | temp+rename 但不 fsync | 掉电后可能看到重命名完成但内容为空/半截 | 状态文件损坏（有备份兜底） | fsync 文件与目录；启动清理 `.tmp-*` |
| F7 | low | `routes-status.js` / `analytics.js` | `?range=` 原值回显进 `content-disposition` 文件名 | `?range=a";filename="evil` → 文件名被污染（Node 已拦 CR/LF，非头注入） | 下载文件名误导 | range 走白名单后再拼 |
| F8 | low | `scaffold.js` | `name` 可含换行 → 注入 AGENTS.snippet.md 标题结构 | `{name:'A\n\n### injected heading'}` 实测生效 | 用户自己的 AGENTS.md 被扰动（同源写入，无提权） | 去控制字符/换行 |
| F9 | low | `index.js` `configEditor.edit` | 猴子补丁改写共享服务并挂 `__ctxBackedUp`，不还原 | 任意 `configEditor.edit` 调用都多一次文件备份；卸载后仍生效 | 写放大、与其他插件补丁顺序耦合 | 在 dispose 还原原方法 |

## 已验证为安全

1. **鉴权覆盖**：23 条路由全部包 `authed`；实测无 cookie → 401、`Origin/ Host` 伪造 → 403。
2. **fail-closed 无裸奔分支**：有 `webServer` 无 `connection` → 403；路由只在 `ctx.inject(['webServer'])` 内注册，故「无 webServer 放行」在 HTTP 面不可达。
3. **POST 形态控制**：非 `application/json` → 415，阻断跨站 `text/plain` 简单请求。
4. **体积上限**：256KB / config 16KB / scaffold 64KB，超限 413 且 `request.destroy()`。
5. **文件级路径逃逸**：`slug` 拒绝 `..`/绝对/点；逐文件 `startsWith(root+sep)`；AGENTS.md 路径为常量。
6. **状态目录**：profile 名受 `^[A-Za-z0-9._-]+$` 约束；文件名全为常量；`DSH_HOME` 只平移根。
7. **配置写入无注入**：`parseConfigPatch` 逐键白名单 + 类型/区间校验；写入保留其他字段。
8. **数据清理范围受限**：`data/reset` 只清 compaction log 与 session toggles。
9. **信息泄漏**：`/status` 只含版本、profile 名、预算、测量、价格行，无 key/token/绝对路径；CSV 公式注入已中和。
10. **有界集合**：measurements 10、foldCache 60、budgets 200、toggles 200、log 200 条、status cache 单槽（例外见 F3）。
11. **无代码执行原生面**：运行时代码无 `eval`/`new Function`/`child_process`；MCP `command/args` 只写配置不执行。
12. **备份真的在跑**：生产状态目录存在 30+ 份 `.bak`，证实备份路径有效。

## 与 security-audit.md 的差异（作者文档需更新）

1. §6 称「有 webServer 但无 connection 的自定义组合下路由放行」——**已不成立**（0.25.0 起 fail-closed，`PERMISSIONS.md` 写的 403 才是对的，两份文档互相矛盾）。
2. §2 称「所有写路径只有 profile patch 与 `~/.dsh/agent-embodiment/**`」——**不成立**：`scaffold/generate` 接受任意绝对 `targetDir`，仅黑名单过滤，而 F2 证明黑名单可绕过。
3. §1「MCP 只写配置不执行」——**对插件进程成立，对最终产物不成立**：生成的 bundle patch 是 `!!js` 求值面（见 F1）。
4. §6「状态持久化原子写」——方向对、强度不足（无 fsync，见 F6）。
5. 未覆盖：F3 / F4 / F5 / F7 这四类资源与并发问题在作者文档里没有对应条目。

## 未验证（不计入发现）

- `promptOverrides` / `extraPrompts` 的任意键写入 YAML 时是否被 config-editor 正确引用（取决于其序列化实现）。
- `tools.restrict({deny})` 是否支持通配符。
- 符号链接逃逸仅按代码推理，未构造 junction 实测。
- NTFS 掉电后 temp+rename 的实际结果未做断电注入。
