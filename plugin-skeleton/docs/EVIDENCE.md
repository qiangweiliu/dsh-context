# 验收证据（ctx-mon-and-con）

- 仓库：<https://github.com/qiangweiliu/dsh-context>（插件目录 `plugin-skeleton/`）
- 版本：`0.14.13`（本文件随 manifest 兼容性声明一起提交）
- 采集日期：2026-10-18
- 证据层级说明：`verified` = 本次固定源码上实际执行并记录结果；`partial` = 只在明确边界内验证；`unknown` = 未取得证据。**这些证据不构成独立安全审计，也不替代商城的专项审阅。**

## 环境

| 环境 | 宿主 | Node | Profile | 说明 |
| --- | --- | --- | --- | --- |
| A | Windows 桌面版 DSH `0.2.1-rc.2` | 随应用 runtime（Node 24.x） | `desktop`（Electron 独占） | 真实日常使用环境 |
| B | WSL2 Ubuntu 24.04，`dsh 0.2.0-rc.2` | `v26.10.0` | `web`（一次性测试 profile） | 安装/启动/卸载/UI 自动化验证 |

## E1. 离线契约与测试（verified）

```text
node test/static.mjs   → [static] 47/47 项通过
node test/smoke.mjs    → [smoke] 43/43 项通过
node test/control.mjs  → [control] 39/39 项通过
```

覆盖：插件导出形状、Config Standard Schema 校验、package `exports` 解析、locale、bundle patch 结构、client 渲染注册、control 半侧状态机与压缩区间（含预算不足时不调用 `compactRegion` 的负例）；本次新增 manifest 契约检查（`engines.node`、`engines.dsh`、`dsh.compatibility.dshReleases`、无生命周期脚本、运行文件已分发、无 npm 运行依赖）。

## E2. 一次性 Profile 安装（verified）

```bash
dsh plugin --profile web add /home/wu/dsh-plugins/ctx-mon-and-con
```

```text
+ ctx-mon-and-con link:../../../dsh-plugins/ctx-mon-and-con
ok   - bundles 含该包: true
ok   - dependencies 含该包: true
ok   - node_modules/ctx-mon-and-con 存在（link -> /home/wu/dsh-plugins/ctx-mon-and-con）
ok   - --dump-config 出现该行（5 处）
安装完成：ctx-mon-and-con@0.14.13 已进入 profile web
```

## E3. 启动与 UI（verified，web profile）

启动：`dsh --profile web`（无头，等待 token 后访问 `http://127.0.0.1:3080/?token=…`）。

```json
GET /api/ctx-mon-and-con/status
{
  "plugin": "ctx-mon-and-con",
  "version": "0.14.13",
  "budget": { "tokens": 128000, "warnAt": 0.75, "errorAt": 0.9, "source": "default" },
  "control": { "active": true, "mode": "idle", "presetMounted": true, "lastError": null }
}
```

真实浏览器（headless Edge + CDP）打开侧栏 ctx 页：

```json
{
  "ok": true,
  "version": "v0.14.13",
  "title": "上下文监控",
  "chipTitleAttr": "插件版本: 0.14.13",
  "panelPresent": true,
  "errors": []
}
```

自动挂载生效：profile `cordis.patch.yml` 中出现 `preset-standard` 覆盖段与 `ctx-mon-and-con-control` 行（`mode: idle`），控制半侧 `presetMounted: true`。

## E4. 卸载与残留清理（verified）

```text
dsh plugin --profile web remove ctx-mon-and-con
ok   - dsh plugin remove 成功：- ctx-mon-and-con link:/home/wu/dsh-plugins/ctx-mon-and-con
cleaned: preset-standard(auto-mount)
ok   - profile patch 清理完成
ok   - package.json dependencies 不再含该包
ok   - package.json bundles 不再含该包
ok   - 移除残留 symlink（-> /home/wu/dsh-plugins/ctx-mon-and-con）
ok   - --dump-config 不再出现该行
结论：ctx-mon-and-con 已从 profile web 卸载，依赖/bundles/node_modules/组合树均无该插件。
```

说明：自动挂载会经官方 `configEditor` 在 profile patch 写出行，`dsh plugin remove` 不会代删；仓库提供 `scripts/clean-ctx-profile-patch.mjs`（先备份再按 id 移除）并已内置进 `scripts/wsl-uninstall.sh`。清理后 `--dump-config` 归零。

## E5. Windows 桌面真实 profile（partial）

- 安装组合已注册：`profiles/desktop/package.json` 的 `dependencies` 含 `"ctx-mon-and-con": "link:C:/Users/40410/Desktop/context/plugin-skeleton"`，`dsh.profile.bundles` 含 `ctx-mon-and-con`；已安装副本版本 `0.14.13`。
- 桌面版不允许 CLI 管理该 profile（`profile "desktop" is managed exclusively by the Electron application`），由 Electron 启动时加载；历史运行实例已验证：status 路由 HTTP 200、`version` 与已安装副本一致、`control.active: true`、`presetMounted: true`，并真实执行过压缩（一次记录：before `215229` → after `80639`，`lastError: null`）。
- **当前运行实例是旧版本（0.14.11），0.14.13 需重启桌面版后生效**；重启后应出现「上下文监控 / v0.14.13」与 `data-ctx-version` 标签。

## E6. 权限静态审计（partial）

在固定源码上人工核对（非商城扫描器结论）：

```text
process.env 引用：0
child_process / execSync / spawn：0
outbound fetch（宿主）：0；client.js 的 fetch 全部是同源相对路径
文件写入：~/.dsh/ctx-mon-and-con/session-toggles.json、backups/、经 configEditor 写 profile patch
文件读取：插件状态文件；宿主 @deepseek-ai/*/lib/*.js（只读索引，≤700 文件 / 2 MiB）
npm 运行依赖：无；生命周期脚本：无
外部服务/遥测/CDN：无
```

完整权限矩阵与失败边界见 [PERMISSIONS.md](PERMISSIONS.md)。

## 已知限制（unknown）

- 未进行独立安全审计；本文件不声称“安全通过”。
- 未对 `0.2.0-rc.1`、`0.2.1-alpha.*`、`0.1.x` 等宿主版本做运行验证，`dshReleases` 中未声明的版本保持 `unknown`。
- 桌面 profile 的安装由 Electron 管理，证据来自真实运行实例，但不是一次性 Profile 的自动化夹具。
- 商城的源码静态扫描结论以商城固定 Commit 为准；本仓库只提供上述可复现证据。
