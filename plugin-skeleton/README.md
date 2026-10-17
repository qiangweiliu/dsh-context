# ctx-mon-and-con

DSH（DeepSeek Harness）的**上下文长度管理**插件，分两个平面：

- **宿主半侧（`index.js`，装完即有）**：`/ctx` 读出当前会话的 token 用量与预算，只读的设置面板 + `GET /api/ctx-mon-and-con/status`；**不修改会话**。
- **控制半侧（`control.js`，需要挂进 agent preset）**：到达预算就自动压缩，或手动 `/ctx-compact`；走官方 `ctx.compaction` seam，不自己造压缩。

## 三条功能

| # | 功能 | 怎么用 |
| --- | --- | --- |
| 1 | 监控当前会话上下文长度 | 会话里发 `/ctx`；设置 → 上下文面板；`GET /api/ctx-mon-and-con/status` |
| 2 | 设置上下文长度（预算） | `/ctx <tokens>` 设**当前会话**的临时预算、`/ctx reset` 恢复默认；全局默认在插件 `Config.contextWindowTokens`（profile patch 或 preset 里改） |
| 3 | 到达预算时主动压缩 | 控制半侧 `mode: idle`（默认）在轮末自动压缩；需要 step 内触发用 `pre-step`；也可 `/ctx-compact` 手动压 |

**预算三级取值**（控制半侧每次触发时实时计算，改完立即生效）：会话级覆盖（`/ctx <tokens>`）→ 宿主默认（`Config.contextWindowTokens`）→ 控制行自己的 `maxContextTokens`。

## 控制半侧做什么

| `mode` | 行为 |
| --- | --- |
| `idle`（默认） | 每轮结束（`agent/status === 'idle'`）测量，超过预算就调用 `ctx.compaction.compactNow()` 强制压缩；压完仍超会按 `maxAttempts` 重试，直到降到预算以下或无可安全压缩的范围 |
| `pre-step` | 每个 step 边界调用 `ctx.compaction.compactIfNeeded(agent, 'pressure', signal)`，由本插件决定触发时机（适合把 `compaction-basic.auto` 关掉后接管） |
| `notify` | 只测量并写日志，不动作 |
| `off` | 完全不启用 |

压缩目标是「**降到预算以下即可**」：复用引擎自己的选区逻辑，不自己算范围、不写 `surfaceOp`、不碰影子价。另外注册 `/ctx-compact`：立刻对该会话做一次 idle 压缩（同样要求 agent 空闲）。

```yaml
# 设置 → Agent preset（或在 profile patch 的 preset 配置里）加一行：
- id: ctx-mon-and-con-control
  name: 'ctx-mon-and-con/control'
  config:
    mode: idle          # off | notify | idle | pre-step
    cooldownMs: 60000   # 两次自动压缩最小间隔
    maxAttempts: 2      # 压完仍超预算时最多连续压几次
    # maxContextTokens: 100000  # 0（默认）= 跟随宿主默认与会话覆盖
```

**为什么必须挂在 preset 里**：Web 形态下 `dsh-web-app` 把宿主平面的 `compaction-basic` / `command-compact` / `tool-result-pruner` 全部置为 `disabled`，真正运行的 `compaction` 服务在 `preset-standard` 的 `cordis:group`（`isolate: { compaction: true }`）内。宿主上下文 `ctx.get('compaction')` 拿不到它 —— 面板里的「控制」一行会直接显示当前是否已生效（状态经 `state.js` 在两个半侧之间共享）。

## 卸载与残留（实测）

```powershell
# 官方通道，等价于插件管理器的 remove_bundle
& <dsh> plugin --profile desktop remove ctx-mon-and-con
```

实测结论（隔离 profile 20/20 项通过，真实 desktop profile 同样验过）：

| 场景 | package.json / bundles | pnpm-lock | cordis.patch.yml | 命令/面板 |
| --- | --- | --- | --- | --- |
| **冷卸载**（先退出 Desktop） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |
| **热卸载**（Desktop 运行中，`link:` 本地目录安装） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |
| **热卸载**（`github:` / npm 安装） | 恢复原样 | 恢复原样 | 未改动 | 重启后消失 |

热卸载唯一的差异：`link:` 安装会残留一个 `node_modules/ctx-mon-and-con` **junction**（pnpm 在应用占用该目录时删不掉，实测 cold 卸载不会）。它只指向你的插件源码目录、不是真实副本，用下面的脚本 `-Clean` 可以安全移除（`rmdir` 只删 junction，不碰源码）：

```powershell
# 需要 PowerShell（Windows 自带 powershell.exe 即可）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-uninstall.ps1 -Profile desktop -Clean
```

脚本会：快照 → 安装 → 校验（依赖/bundles/link/组合树）→ 卸载 → 与快照对比 → 分类报告残留。
不带 `-Clean` 时只报告不清理；带上则顺带清掉三类**通用**残留（任何插件都一样）：
空 `pnpm-lock.yaml`、空的 `node_modules/.pnpm` 与 `.pnpm-workspace-state-v1.json`、本次操作产生的 `.plugin-manager/logs/operation-*`。

第三方观测到的两个注意点：

- **重启 Desktop 后** `/ctx`、`/ctx-compact` 与设置面板才会真正消失：运行中的进程会保留已加载的模块，卸载只改 profile 配置，不会热卸载已激活的插件。
- `desktop` profile 由 Electron 独占，CLI 拒绝 `--dump-config`；组合树是否含该行要在非 desktop profile 或应用重启后验证（脚本会自动跳过这一项并说明）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Cordis 插件（宿主侧）：`name` / `inject` / `Config`（手写 Standard Schema）/ `apply(ctx, config)`，注册 `/ctx` 命令与状态路由 |
| `control.js` | Cordis 插件（preset 侧）：预算控制 + `/ctx-compact`，零 import，只用 `ctx.compaction` 服务 |
| `state.js` | 两个半侧共享的进程内状态（默认预算 / 会话覆盖 / 控制状态）；只是同包相对 import |
| `client.js` | 浏览器半侧：`window.__ModuleLoader__.load({ id, factory })` 形态，`apply(ctx)` 注册 `settings.section` 面板 |
| `dsh.bundle.patch.yml` | bundle 层：往 profile 的 boot graph `insert` 一行 `id: ctx-mon-and-con` |
| `locale/{en,zh}.json` | 插件市场/插件管理页显示的 `meta.title` / `meta.description` |
| `icon.svg` | 插件图标（`exports["./icon"]` 暴露） |
| `test/static.mjs` | 纯离线静态检查（32 项，不需要 DSH） |
| `test/smoke.mjs` | 用真实 Cordis 的集成冒烟测试（43 项，需先 `node test/prepare-deps.mjs`） |
| `test/control.mjs` | 控制半侧的离线测试（33 项：预算来源、idle/pre-step/notify、重试、cooldown、命令、状态回写、卸载） |
| `test/prepare-deps.mjs` | 从 app.asar 离线解出 cordis/cosmokit 到 `test/deps/`（交付不带第三方副本） |
| `test/dump-config-smoke.txt` | 隔离 profile 里 `--dump-config` 的实际输出证据 |

设计上 **`index.js` 不 import 任何 npm 包**：本地目录安装时插件以 `link:` 落在 profile 的 `node_modules` 里，Node 会按真实路径解析裸导入，而插件目录通常没有宿主依赖（见下文"限制"）。

## 安装

前提：先打开过一次 DeepSeek Harness Desktop（初始化 `~/.dsh/profiles/desktop`），装完插件后重启 Desktop。

### 方式 A：Desktop 插件管理（推荐）

在会话里让 agent 调用 `plugin_manager` 工具：

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\ctx-mon-and-con" }
```

`install_bundle` 的 `target` 可以是本地目录、包名、git 或 tarball；本地目录会被记录成 `link:` 依赖。该工具需要 `danger-full-access` 权限。装好后 profile 的 `dsh.profile.bundles` 末尾会追加 `ctx-mon-and-con`（"新装组合包默认启用"），因此**同名 id 的配置优先级可能变化**。

### 方式 B：命令行

本机 `dsh` 不在 PATH，用完整路径：

```powershell
$dsh = "C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "C:\path\to\ctx-mon-and-con"
```

底层是 `pnpm add`（本地目录 → `link:`）+ 校验本包的 `dsh.bundle.patch` + 把包名追加进 `package.json` 的 `dsh.profile.bundles`。pnpm 退出码非 0 或超时会回滚 `package.json` 与 `pnpm-lock.yaml`。

> ⚠️ 不要在做安装实验时把 `DSH_HOME` 指到插件目录内部（例如 `<插件>/test/dsh-home`）：profile 的 `node_modules` 会 link 回插件目录，而 profile 又在插件目录里，形成自我引用的无限嵌套。实验用 profile 放到插件目录之外。

### WSL（Linux 侧的 dsh）

```bash
# 在 WSL 里执行；<repo> 换成本仓库路径
bash /mnt/c/<repo>/scripts/wsl-install.sh web      # 安装并核对
bash /mnt/c/<repo>/scripts/wsl-uninstall.sh web    # 卸载并核对残留
```

脚本把插件复制到 `~/dsh-plugins/ctx-mon-and-con` 再执行 `dsh plugin add`（不在 `/mnt/c` 上做 link，避免 drvfs 链接与性能问题）。
实测结论：安装后 `--dump-config` 出现该行、运行时 `/api/ctx-mon-and-con/status` 返回 200、客户端 bundle 正常下发；
卸载后 package.json / bundles / lock / 组合树均无该插件，pnpm 在 Linux 上会残留一个指向插件目录的 symlink，脚本会自动移除。

### 方式 C：手工（不推荐）
等价于管理器做的事：在 profile 目录 `pnpm add link:<插件目录>`，再手动把 `ctx-mon-and-con` 追加到 profile `package.json` 的 `dsh.profile.bundles`。漏掉任何一步插件都不会成为 profile 层（`dsh.bundle.patch` 解析失败时只作为普通依赖安装，管理器会打印 `declares no dsh.bundle` 警告并跳过）。

## 验证

1. **离线自检**（不启动 DSH）：

   ```powershell
   node test/static.mjs        # 32/32：导出形状、Config 校验、exports 解析、locale、client mock、control 形状
   node --check index.js; node --check control.js; node --check client.js
   node test/prepare-deps.mjs  # 可选：从 app.asar 解出 cordis，第一次需要
   node test/smoke.mjs         # 43/43：真实 Cordis 里加载、/ctx 与 reset、状态路由、卸载清理
   node test/control.mjs       # 33/33：预算来源、idle/pre-step/notify、重试、cooldown、命令、状态回写、卸载
   ```

2. **确认 bundle 层生效**：

   ```powershell
   & $dsh --profile desktop --dump-config | Select-String -Pattern 'ctx-mon-and-con' -Context 2
   # 期望看到：
   # # == ctx-mon-and-con
   # - id: ctx-mon-and-con
   #   name: ctx-mon-and-con
   ```

3. **重启 Desktop** 后在会话里发 `/ctx`（命令直接在 UI 命令面执行，不产生模型消息），再打开 设置 → 上下文 看面板；面板拉的接口是 `GET /api/ctx-mon-and-con/status`。

4. **调参**：全局默认在 profile 的 `cordis.patch.yml` 里按 id 覆盖（patch 是**整段替换**，不做深合并）；临时只想改当前会话就发 `/ctx <tokens>`，用完 `/ctx reset`：

   ```yaml
   - id: ctx-mon-and-con
     config:
       contextWindowTokens: 200000
       warnAt: 0.7
       errorAt: 0.85
   ```

## 卸载

```powershell
& $dsh plugin --profile desktop remove ctx-mon-and-con
# 或 plugin_manager: { "action": "remove_bundle", "target": "ctx-mon-and-con" }
```

会同步从 `dsh.profile.bundles` 里移除（管理器负责），重启 Desktop 后命令/面板/路由消失。

## 限制（重要）

- **Web 形态下宿主自带的 `auto` 自动压缩关不掉**：`@deepseek-ai/dsh-web-app` 层已把宿主平面的 `compaction-basic` 行设成 `disabled`，真正运行的实例藏在 `preset-standard` 条目的 `plugins` 里，bundle 层**无法按 id 命中**。要关 `auto` 必须在 profile 级 `cordis.patch.yml` 里对 `preset-standard` 做整段 config 覆盖（会连带把 preset roster 冻结成快照，直到 DSH 更新 preset 后重新复制；billion-context 的 `dsh.bundle.patch.yml` 注释记录了同一限制 DSH #2474）。控制半侧因此**必须挂在 preset 内**，见上节。
- **第三方插件默认不能 `import '@deepseek-ai/*'`**：宿主包在 `app.asar` 内、只由 DSH 自己的 loader（锚在 asar 内）解析，不暴露给插件代码；本机 profile 的 `node_modules` 顶层没有 `@deepseek-ai`。想在插件里用 zod/schemastery 时，必须把它写进 `dependencies`（pnpm 的 hoisted 布局会提升到 profile `node_modules` 顶层），且那是**第二份**副本，不能拿去 `instanceof` 宿主里的类。详见 `research/sample-plugin.md`。
- `client.js` 的 `require('react')` 由平台共享模块表提供，不要打包 React。
- 本骨架未声明 `engines.dsh`（上架插件市场时补上，装前兼容性预检会读它；不合规时可 `dsh plugin --profile desktop allow-version ... --accept-risk` 授权）。
- **宿主半侧的 `/ctx` 只读不改**：它只调用 `ctx.tokenMeter.measure(session)`。真正会改历史的只有控制半侧，而它只通过官方 `ctx.compaction` 服务操作（`compactNow` / `compactIfNeeded`），从不自己写 `surfaceOp` 或拼接事件。

## 许可

MIT
