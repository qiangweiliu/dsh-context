# dsh-context

DeepSeek Harness（DSH）的**上下文长度管理**插件：实施方案 + 可直接安装的最小骨架。
插件包名 **`context-monitor-and-control`**（目录 `plugin-skeleton/`）。

> A context-length management plugin for DeepSeek Harness: a design document plus a minimal, installable plugin skeleton.

## 这是什么

DSH 已经内置了完整的上下文管理底座——计量（`ctx.tokenMeter`）、压缩 seam（`ctx.compaction`）、
工具结果裁剪（`ctx.toolResultPruner`）、会话投影（`ctx.sessionProjections`）。
本仓库不重新造压缩，而是把「**插件应该在哪一层介入、怎么介入、有哪些红线**」讲清楚，
并给出一个能装在 Desktop 里的最小实现（`/ctx` 命令 + 设置面板）。

## 仓库结构

| 路径 | 内容 |
|---|---|
| [`docs/context-length-plugin-plan.md`](docs/context-length-plugin-plan.md) | 完整实施方案：请求组装链路、四条介入路线（L0 配置 / L1 观察 / L2 裁剪 / L3 换后端）、可抄的 patch 片段、安装验证、红线清单 |
| [`plugin-skeleton/`](plugin-skeleton) | 可安装的最小骨架（L1）：`/ctx` 命令 + `settings.section` 面板，含 26 项静态检查与 39 项 Cordis 集成冒烟测试 |
| [`research/arch.md`](research/arch.md) | DSH 插件机制调研：三层结构、Host 插件形态、`dsh` 清单字段、patch DSL、客户端 slots、安装与 HMR |
| [`research/context-core.md`](research/context-core.md) | 上下文/压缩子系统调研：请求组装、token 计量、压缩服务与事件协议、默认后端配置、五条内容变换通道、真实装配层 |
| [`research/sample-plugin.md`](research/sample-plugin.md) | 参考实现分析：`billion-context` / `dsh-bloom-theme` / `dshmarket`，以及第三方插件的模块解析结论 |
| [`docs/market-submission.md`](docs/market-submission.md) | 为什么在插件市场里搜不到、收录规则逐条核对、已实测的安装命令，以及还差的三步 |
| [`submission/`](submission) | 可直接复制进收录 PR 的条目文件 `qiangweiliu__dsh-context--plugin-skeleton.yml` |

## 快速开始

先把 `plugin-skeleton/` 装进你的 profile（二选一）：

```powershell
# A. 由 agent 调用 plugin_manager 工具
{ "action": "install_bundle", "target": "C:\\path\\to\\dsh-context\\plugin-skeleton" }

# B. 命令行（把 <dsh> 换成你的 dsh 启动器完整路径）
& <dsh> plugin --profile desktop add "C:\path\to\dsh-context\plugin-skeleton"
```

重启 Desktop，然后在会话里：

- 发 `/ctx` —— 显示当前会话的 `总用量 / 预算 / 百分比 / 状态`
- 发 `/ctx 200000` —— 临时把本会话预算改成 200000 tokens
- 打开 设置 → 上下文 —— 查看配置预算、阈值与最近的测量值

详情见 [`plugin-skeleton/README.md`](plugin-skeleton/README.md)。

也可以直接从 GitHub 安装（等价于插件市场上架后的安装命令，已实测可装可启动）：

```powershell
& <dsh> plugin --profile desktop add "github:qiangweiliu/dsh-context#path:/plugin-skeleton"
```

插件市场（dshmarket）目前搜不到本插件：市场只收录 `awesome-dsh-plugin` 精选目录里的条目。
原因与收录步骤见 [`docs/market-submission.md`](docs/market-submission.md)。

## 关键结论（写插件前先看）

1. **没有请求中间件**：messages 由会话日志派生并冻结；改变历史的合法通道只有压缩协议（`surfaceOp: { op: 'replace' }`）与 `tool/result` replace + 影子价。
2. **Web 形态下自动压缩实例在 preset 里**：`dsh-web-app` 把宿主平面的 `compaction-basic` 置为 `disabled`，真身挂在 `preset-standard` 的 `cordis:group` 内，bundle 层按 id 打不中；调参必须整段覆盖 `preset-standard`（patch 是整体替换，不深合并）。
3. **第三方插件不能裸 import `@deepseek-ai/*`**：宿主包在 `app.asar` 内，只由 DSH 自己的 loader 解析。要么零 import（只用 `ctx` 服务 + 手写 Standard Schema），要么用 esbuild/tsup 打包进产物。
4. **token 计量是固定 4 字符/token 的启发式**：中文与 JSON schema 严重低估，阈值要留 headroom。

## 许可

MIT
