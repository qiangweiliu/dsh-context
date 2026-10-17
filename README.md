# dsh-context

DeepSeek Harness（DSH）的**上下文长度管理**插件：实施方案 + 可直接安装的最小骨架。
插件包名 **`ctx-mon-and-con`**（目录 `plugin-skeleton/`）。

> A context-length management plugin for DeepSeek Harness: a design document plus a minimal, installable plugin skeleton.

## 这是什么

DSH 已经内置了完整的上下文管理底座——计量（`ctx.tokenMeter`）、压缩 seam（`ctx.compaction`）、
工具结果裁剪（`ctx.toolResultPruner`）、会话投影（`ctx.sessionProjections`）。
本仓库不重新造压缩，而是把「**插件应该在哪一层介入、怎么介入、有哪些红线**」讲清楚，
并给出一个能装在 Desktop 里的最小实现：宿主半侧的 `/ctx` 监控面板，加上挂在 agent preset 内、
按预算自动压缩的 `ctx-mon-and-con/control` 控制半侧。

## 仓库结构

| 路径 | 内容 |
|---|---|
| [`docs/context-length-plugin-plan.md`](docs/context-length-plugin-plan.md) | 完整实施方案：请求组装链路、四条介入路线（L0 配置 / L1 观察 / L2 裁剪 / L3 换后端）、可抄的 patch 片段、安装验证、红线清单 |
| [`plugin-skeleton/`](plugin-skeleton) | 可安装插件：宿主半侧 `/ctx`（监控 + 会话级预算覆盖）与 `settings.section` 面板；控制半侧 `control.js` 挂进 agent preset 后按预算自动压缩。含 32 项静态检查、43 项 Cordis 冒烟、33 项控制测试 |
| [`research/arch.md`](research/arch.md) | DSH 插件机制调研：三层结构、Host 插件形态、`dsh` 清单字段、patch DSL、客户端 slots、安装与 HMR |
| [`research/context-core.md`](research/context-core.md) | 上下文/压缩子系统调研：请求组装、token 计量、压缩服务与事件协议、默认后端配置、五条内容变换通道、真实装配层 |
| [`research/sample-plugin.md`](research/sample-plugin.md) | 参考实现分析：`billion-context` / `dsh-bloom-theme` / `dshmarket`，以及第三方插件的模块解析结论 |
| [`docs/market-submission.md`](docs/market-submission.md) | 为什么在插件市场里搜不到、收录规则逐条核对、已实测的安装命令，以及还差的三步 |
| [`submission/`](submission) | 可直接复制进收录 PR 的条目文件 `qiangweiliu__dsh-context--plugin-skeleton.yml` |
| [`scripts/verify-uninstall.ps1`](scripts/verify-uninstall.ps1) | 实测「安装 → 生效 → 卸载 → 无残留」：快照对比、残留分类、`-Clean` 清理通用残留 |
| [`scripts/ui-probe.mjs`](scripts/ui-probe.mjs) | 无头浏览器（Windows Edge + CDP）实测 UI：打开设置、点开「上下文长度」、执行 `/ctx`，抓控制台错误 |
| [`scripts/wsl-install.sh`](scripts/wsl-install.sh) · [`scripts/wsl-uninstall.sh`](scripts/wsl-uninstall.sh) | 在 WSL 的 DSH profile 里安装/卸载并核对残留（含运行时探针说明） |

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
- 发 `/ctx 200000` —— 把**本会话**的预算临时改成 200000 tokens；`/ctx reset` 恢复默认
- 打开 设置 → **上下文长度** —— 预算、阈值、最近的 `/ctx` 测量值，以及控制半侧是否已生效
  （装完必须**重启 dsh 进程**；只刷新页面不会加载新插件）

到达预算后自动压缩需要把控制半侧挂进 agent preset（否则插件只做监控）：

```yaml
- id: ctx-mon-and-con-control
  name: 'ctx-mon-and-con/control'
  config: { mode: idle }
```

详情见 [`plugin-skeleton/README.md`](plugin-skeleton/README.md)。

也可以直接从 GitHub 安装（等价于插件市场上架后的安装命令，已实测可装可启动）：

```powershell
& <dsh> plugin --profile desktop add "github:qiangweiliu/dsh-context#path:/plugin-skeleton"
```

插件市场（dshmarket）目前搜不到本插件：市场只收录 `awesome-dsh-plugin` 精选目录里的条目。
原因与收录步骤见 [`docs/market-submission.md`](docs/market-submission.md)。

卸载与残留实测：`& <dsh> plugin --profile desktop remove ctx-mon-and-con`，
详见 [`scripts/verify-uninstall.ps1`](scripts/verify-uninstall.ps1) 与 [`plugin-skeleton/README.md`](plugin-skeleton/README.md#卸载与残留实测)。

## 关键结论（写插件前先看）

1. **没有请求中间件**：messages 由会话日志派生并冻结；改变历史的合法通道只有压缩协议（`surfaceOp: { op: 'replace' }`）与 `tool/result` replace + 影子价。
2. **Web 形态下自动压缩实例在 preset 里**：`dsh-web-app` 把宿主平面的 `compaction-basic` 置为 `disabled`，真身挂在 `preset-standard` 的 `cordis:group` 内，bundle 层按 id 打不中；调参必须整段覆盖 `preset-standard`（patch 是整体替换，不深合并）。
3. **第三方插件不能裸 import `@deepseek-ai/*`**：宿主包在 `app.asar` 内，只由 DSH 自己的 loader 解析。要么零 import（只用 `ctx` 服务 + 手写 Standard Schema），要么用 esbuild/tsup 打包进产物。
4. **token 计量是固定 4 字符/token 的启发式**：中文与 JSON schema 严重低估，阈值要留 headroom。

## 许可

MIT
