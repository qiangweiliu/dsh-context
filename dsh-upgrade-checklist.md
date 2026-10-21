# DSH 与 dsh-context 升级清单

目标：DSH 0.2.1-rc.1 → 0.2.1-rc.2，dsh-context 0.66.1 → 0.74.0（npm 上的 latest，2026-10-21 发布，支持 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.2）。

## 1. 升级 DeepSeek Harness

桌面端：应用内检查更新，或从官网重新下载安装包覆盖安装。装好后确认版本为 0.2.1-rc.2（关于页 / 设置页；CLI 版可用 `dsh --version`）。

> 0.2.1 线只有 rc.2 在插件支持矩阵内；rc.1 与 rc.2 的事件/接口差异没有公开验证，建议先升应用再升插件。

## 2. 升级插件

在 Windows 终端（PowerShell / CMD）执行：

```powershell
dsh plugin --profile web update dsh-context@latest
```

或在应用里：侧边栏 **Plugins** → 插件市场搜索 `dsh-context` → 更新到 0.74.0。

确认安装版本：

```powershell
dsh plugin --profile web list
```

应显示 `dsh-context@0.74.0`。

## 3. 升级后的首次检查

1. 重启应用（插件宿主端在启动时加载）。
2. 打开一个会话，运行 `/context`，看弹窗是否正常。
3. 切到 **上下文 / Context** 标签，确认统计、趋势、浏览器卡片有数据。
4. 打开 **Context Insights**：0.74.0 里时间线投影的 `stateVersion` 从 27 升到 28，首次打开会重新折叠历史会话的投影行，页面可能渐进填充几秒，属正常现象。

## 4. 出问题时的处理

- 某个历史会话的 Context 标签空白或统计异常：删除该会话的投影缓存后重开，缓存是派生数据，会从会话日志重建：

  ```powershell
  Remove-Item "$env:USERPROFILE\.dsh\storages\session_projcache\sessions\<session-id>.json"
  ```

- 插件与当前应用不匹配、无法加载：回滚到旧版并等待应用更新：

  ```powershell
  dsh plugin --profile web add dsh-context@0.66.1
  ```

- 如果 `dsh plugin` 因 `engines.dsh` 版本检查拒绝安装（0.74.0 新增），先确认应用确实升到了 0.2.1-rc.2；不建议用 `dsh plugin allow-version` 强行绕过。

## 5. 留在 0.66.1 时的临时规避（仅在无法升级时）

- 不要一次打开包含大量历史会话的 Insights 页（长会话折叠会冻结主进程）。
- 长会话优先用 `/context` 命令，少开完整 Context 标签（全量 DOM 渲染）。
- 反向代理务必部署在根路径，不要用 `/app/dsh/` 这类前缀。
- 不要安装/注册名为 `__proto__` 的工具（会卡死会话投影）。
- 余额胶囊如显示异常，多为 baseURL 带路径或非 DeepSeek provider 配置导致，0.74.0 已修。
