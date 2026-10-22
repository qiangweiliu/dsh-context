# 约束与已知限制

本文记录 `ctx-mon-and-con` 的使用约束、行为边界和未验证项。面向用户的功能说明见 [README.md](../README.md)，实现细节见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。

## 1. 安装、启停与更新

DSH 默认启用 HMR（`dsh-hmr` + `dsh-client-hmr`），因此：

- **首次安装**：`dsh plugin add` 成功后，宿主半侧会在数秒内热挂载；Web 页面会跟随客户端模块图自动出现，**不需要重启 DSH**。实测约 4 秒（见 `EVIDENCE.md` E16）。
- **Desktop**：0.2.1-rc.2 已实测，运行中 add/remove 后侧栏与面板即时出现/消失，不需要重启（`EVIDENCE.md` E17）。
- **启用/停用插件行**：即时生效。
- **刷新页面**：如果页面仍显示旧界面，刷新一次即可重新加载客户端 bundle；这比重启 DSH 更轻。
- **替换已安装包（升级到新版本）**：DSH 会缓存已挂载包的 manifest 与模块代际，官方明确该场景不是热升级路径，**仍需重启 DSH 进程**。
- **宿主没有 HMR**：如果 profile 的自定义 patch 关闭了 `hmr`，运行中的进程不会重新组合，此时安装/卸载才需要重启。
- **卸载**：HMR 会即时卸载 `/ctx`、`/ctx-compact` 和面板；只有替换/删除宿主模块或没有 HMR 时才需要重启。profile patch 里的残留行仍建议用清理脚本移除。

如果安装后仍未出现，按顺序检查：

1. **profile 是否一致**：Desktop 运行的是 `desktop`，WSL `dsh web` 通常是 `web`。带 `--profile` 安装到另一个 profile 不会出现在当前实例里。
2. **DSH 版本**：支持矩阵是 `0.2.0-rc.2` / `0.2.1-rc.2`；`0.2.1-rc.1` 不在矩阵内，旧版本也可能没有 `dsh-client-hmr`。
3. **HMR 是否被关闭**：自定义 profile patch 若把 `hmr` 行设为 `disabled: true`，运行中的进程不会重新组合。
4. **是否在替换已安装包**：升级到新版本属于 DSH 的“package replacement”，仍需重启进程；首次安装不受此限制。
5. **页面是否陈旧**：Web 刷新一次即可；Desktop 0.2.1-rc.2 实测无需刷新，若仍未出现再重启应用。

## 2. 上下文与预算的边界

- `contextWindowTokens` 是插件预算，不改变模型真实窗口。
- 当预算低于「系统提示 + 工具定义」的基础开销时，压缩无法把用量降到目标线以下。
- `warnAt` / `errorAt` 只影响显示颜色，不参与自动压缩。
- 自动压缩依赖 DSH 的 compaction 服务；没有可安全压缩的历史时会跳过。

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
- 自动挂载会写入 `preset-standard` 的配置快照；
- DSH 升级 preset 后，需要重新启用或手工同步；
- 控制行是否生效以面板「控制」卡状态为准。

## 6. 扫描与统计范围

- 跨会话分析默认只扫描最近 40 个会话，不是全量。
- 费用只对内置价格表覆盖的 DeepSeek 模型估算；未知 provider/模型显示 `—`。
- 缓存命中、工具调用、压缩次数来自会话事件折叠，可能受日志完整度影响。
- 趋势和事件页依赖历史会话日志；缺少日志的会话不会出现在统计中。

## 7. 平台与安装

- `desktop` profile 由 Electron 独占，部分 CLI 操作（如 `--dump-config`）不可用。
- 本地目录安装使用 `link:`；Windows 热卸载可能残留 junction，需要脚本清理。
- DSH 升级可能覆盖 preset 或 profile 配置；升级后应重新确认控制行和面板状态。
- 第三方插件不能默认 `import '@deepseek-ai/*'`；本插件因此不 import 宿主包。
- 不要将 `DSH_HOME` 指到插件目录内部，避免 profile 与插件目录互相引用。

## 8. 未验证项

- 未对 DSH `0.2.0-rc.1`、`0.2.1-alpha.*`、`0.1.x` 做运行验证。
- Desktop 插件管理器的部分边界行为与 Web 形态不同，不能完全用 WSL 结果替代。
- 未进行独立安全审计；[PERMISSIONS.md](../PERMISSIONS.md) 只披露访问面，不构成安全认证。
- 自动压缩在高负载/超大历史下的耗时未做系统性压测。
- 新增提示词在 Desktop Electron 中的 UI 交互仍需按实际版本验收。

## 9. Agent 脚手架

- 只写用户提交的**绝对**工作区目录；拒绝文件系统根目录/用户 home，默认不覆盖已有文件。
- 生成的是起点模板，不保证直接达到生产质量；必须用真实任务和 eval 继续迭代。
- 生成的 preset 复用 `ctx-mon-and-con/control`；同一 profile 需要安装本插件，否则 preset 激活会失败。
- MCP 行可由用户提交的 JSON 生成（stdio / streamable-http）；插件只写配置，不执行 MCP 命令；secret 用 `${ENV_VAR}`，安装/启用前仍需审查 command/args 与凭据。
- `AGENTS.md` 支持带 marker 的幂等合并（保留用户内容）；不勾选 `writeAgents` 时只生成 `AGENTS.snippet.md`。
- `evals/run.mjs` 只负责按 case 调 `dsh headless` 并记录 transcript，不自动判断正确性；需要人工按 `expect` 审阅。
- 不会自动修改默认 preset；安装后在 Settings → Agent presets 手动选择。
- **子 agent 跨版本差异**：DSH 0.2.1-rc.2 已移除 `dsh-tool-subagent` 的 `persona` / `toolFilter`。生成器只使用跨版本字段，角色说明放在 `delegate-<role>` skill；如果需要子 agent 的工具隔离或独立 persona，应另建 Agent Preset 并用 `agentPreset` 选择。
- 脚手架不是安全沙箱：它只约束写盘路径、覆盖行为和默认 MCP secret 形式，不限制生成后的 agent 工具权限。

## 10. 其他

- 插件不会修改会话历史来“修复”旧提示词；它只影响后续请求。
- 配置写入会改动 profile 的 `cordis.patch.yml`，请保留备份。
- 如果面板数字与实际 provider 用量差异较大，以 provider 的 usage 为准。
