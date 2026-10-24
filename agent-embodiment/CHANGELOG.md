# Changelog

格式参考 Keep a Changelog；版本遵循 SemVer。DSH 兼容版本写在每个条目的 Compatibility 下。

## [0.23.0] - 2026-10-24

### Added

- `compressionStrategy` preset：`conservative`（0.9 / 0.7 / 保留 35%）、`balanced`（1 / 0.6 / 25%）、`aggressive`（0.75 / 0.5 / 10%）；显式 `triggerAt` / `targetAt` / `keepTokens` 优先。
- 设置页增加压缩策略选择；切换策略会同步触发/目标比例。
- `analyticsLimit` 配置（1..200，默认 40），`?limit=` 仍可临时覆盖。
- 控制行未挂载时，工具/提示词修改会显示提示并拒绝执行。
- 静态测试新增压缩策略/control 未挂载提示断言。

### Changed

- 版本升到 `0.23.0`。

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
