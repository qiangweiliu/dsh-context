# dsh-context

DeepSeek Harness（DSH）的 agent 具身与上下文管理插件项目。

插件包名：`agent-embodiment`
市场标题：`Agent Embodiment` / `智能体具身`
插件目录：[`agent-embodiment/`](agent-embodiment/)
当前版本：`0.26.0`

在 DSH 原生上下文管理之上，提供跨会话用量分析、会话级预算/提示词/工具控制、压缩洞察与节省估算，以及可选的 Agent 脚手架。压缩、token 计量、工具与子 agent 由 DSH 本体提供。

面板侧栏名是 `Context` / `上下文`，固定 Overview / Trend / Events / Settings 四个 tab；脚手架在 Settings → Labs。首次运行会询问预算、压缩策略和控制行挂载授权，可以跳过。

功能、入口和安装说明见插件 README：[agent-embodiment/README.md](agent-embodiment/README.md)。

## 更多文档

- 实现细节：[agent-embodiment/docs/IMPLEMENTATION.md](agent-embodiment/docs/IMPLEMENTATION.md)
- 约束与已知限制：[agent-embodiment/docs/LIMITATIONS.md](agent-embodiment/docs/LIMITATIONS.md)
- 权限说明：[agent-embodiment/PERMISSIONS.md](agent-embodiment/PERMISSIONS.md)
- 验证证据：[agent-embodiment/docs/EVIDENCE.md](agent-embodiment/docs/EVIDENCE.md)

## 许可

MIT
