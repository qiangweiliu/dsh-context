# dsh-context

DeepSeek Harness（DSH）的上下文管理插件项目。

插件包名：`ctx-mon-and-con`

插件目录：[`plugin-skeleton/`](plugin-skeleton/)

当前版本：`0.16.0`

## 功能

### 1. 控制上下文长度

- 设置当前会话的上下文上限和压缩触发线。
- 达到触发线时自动压缩，减少后续请求的 token 消耗。
- 手动压缩当前会话：

```text
/ctx-compact
```

- 临时修改当前会话上限：

```text
/ctx 200000
/ctx reset
```

### 2. 监控上下文

- 查看当前会话的上下文用量、剩余空间和占用比例。
- 查看提示词、工具定义、历史消息、本轮对话各占多少 token。
- 面板提供概览、趋势、事件三个视图。
- 输入框下方会显示 `ctx` 指示器。

### 3. 修改提示词

- 查看当前实际加载的提示词 section 和 token 占用。
- 覆盖已有提示词，或为当前会话单独修改。
- 按会话关闭不需要的提示词。
- 新增一条独立提示词，不覆盖原有提示词。
- 修改在之后的请求中生效；已有会话的旧提示词历史不会被删除，需要完全替换时请新建会话。

## 入口

可以从三个地方打开面板：

- 左侧导航的 `ctx`；
- 设置 → 上下文；
- 输入框下方的 `ctx` 指示器。

也可以在会话中直接使用 `/ctx` 查看当前上下文。

## 更多文档

- 插件说明：[plugin-skeleton/README.md](plugin-skeleton/README.md)
- 实现细节：[plugin-skeleton/docs/IMPLEMENTATION.md](plugin-skeleton/docs/IMPLEMENTATION.md)
- 约束与已知限制：[plugin-skeleton/docs/LIMITATIONS.md](plugin-skeleton/docs/LIMITATIONS.md)
- 权限说明：[plugin-skeleton/PERMISSIONS.md](plugin-skeleton/PERMISSIONS.md)
- 验证证据：[plugin-skeleton/docs/EVIDENCE.md](plugin-skeleton/docs/EVIDENCE.md)

## 许可

MIT
