# dsh-context-guard

DSH（DeepSeek Harness）的**上下文长度管理**最小插件骨架：一条 `/ctx` 命令读出当前会话的 token 用量与预算，外加一个只读的设置面板；不修改会话、不自动压缩，适合作为"做一个 DSH 插件"的起点。

- `/ctx` —— 显示 `总用量 / 预算 / 百分比 / 状态`；`/ctx 200000` 临时改本会话预算。
- 设置 → 上下文 —— 显示配置的预算、阈值和最近的 `/ctx` 测量值。
- `GET /api/context-guard/status` —— 面板用的只读 JSON 接口（无 Web server 的 profile 自动跳过）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Cordis 插件（node 侧）：`name` / `inject` / `Config`（手写 Standard Schema）/ `apply(ctx, config)`，注册 `/ctx` 命令与状态路由 |
| `client.js` | 浏览器半侧：`window.__ModuleLoader__.load({ id, factory })` 形态，`apply(ctx)` 注册 `settings.section` 面板 |
| `dsh.bundle.patch.yml` | bundle 层：往 profile 的 boot graph `insert` 一行 `id: context-guard` |
| `locale/{en,zh}.json` | 插件市场/插件管理页显示的 `meta.title` / `meta.description` |
| `icon.svg` | 插件图标（`exports["./icon"]` 暴露） |
| `test/static.mjs` | 纯离线静态检查（26 项，不需要 DSH） |
| `test/smoke.mjs` | 用真实 Cordis 的集成冒烟测试（39 项，需先 `node test/prepare-deps.mjs`） |
| `test/prepare-deps.mjs` | 从 app.asar 离线解出 cordis/cosmokit 到 `test/deps/`（交付不带第三方副本） |
| `test/dump-config-smoke.txt` | 隔离 profile 里 `--dump-config` 的实际输出证据 |

设计上 **`index.js` 不 import 任何 npm 包**：本地目录安装时插件以 `link:` 落在 profile 的 `node_modules` 里，Node 会按真实路径解析裸导入，而插件目录通常没有宿主依赖（见下文"限制"）。

## 安装

前提：先打开过一次 DeepSeek Harness Desktop（初始化 `~/.dsh/profiles/desktop`），装完插件后重启 Desktop。

### 方式 A：Desktop 插件管理（推荐）

在会话里让 agent 调用 `plugin_manager` 工具：

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\dsh-context-guard" }
```

`install_bundle` 的 `target` 可以是本地目录、包名、git 或 tarball；本地目录会被记录成 `link:` 依赖。该工具需要 `danger-full-access` 权限。装好后 profile 的 `dsh.profile.bundles` 末尾会追加 `dsh-context-guard`（"新装组合包默认启用"），因此**同名 id 的配置优先级可能变化**。

### 方式 B：命令行

本机 `dsh` 不在 PATH，用完整路径：

```powershell
$dsh = "C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "C:\path\to\dsh-context-guard"
```

底层是 `pnpm add`（本地目录 → `link:`）+ 校验本包的 `dsh.bundle.patch` + 把包名追加进 `package.json` 的 `dsh.profile.bundles`。pnpm 退出码非 0 或超时会回滚 `package.json` 与 `pnpm-lock.yaml`。

> ⚠️ 不要在做安装实验时把 `DSH_HOME` 指到插件目录内部（例如 `<插件>/test/dsh-home`）：profile 的 `node_modules` 会 link 回插件目录，而 profile 又在插件目录里，形成自我引用的无限嵌套。实验用 profile 放到插件目录之外。

### 方式 C：手工（不推荐）

等价于管理器做的事：在 profile 目录 `pnpm add link:<插件目录>`，再手动把 `dsh-context-guard` 追加到 profile `package.json` 的 `dsh.profile.bundles`。漏掉任何一步插件都不会成为 profile 层（`dsh.bundle.patch` 解析失败时只作为普通依赖安装，管理器会打印 `declares no dsh.bundle` 警告并跳过）。

## 验证

1. **离线自检**（不启动 DSH）：

   ```powershell
   node test/static.mjs        # 26/26：导出形状、Config 校验、exports 解析、locale、client mock
   node --check index.js; node --check client.js
   node test/prepare-deps.mjs  # 可选：从 app.asar 解出 cordis，第一次需要
   node test/smoke.mjs         # 39/39：真实 Cordis 里加载、注册命令/路由、卸载清理
   ```

2. **确认 bundle 层生效**：

   ```powershell
   & $dsh --profile desktop --dump-config | Select-String -Pattern 'dsh-context-guard' -Context 2
   # 期望看到：
   # # == dsh-context-guard
   # - id: context-guard
   #   name: dsh-context-guard
   ```

3. **重启 Desktop** 后在会话里发 `/ctx`（命令直接在 UI 命令面执行，不产生模型消息），再打开 设置 → 上下文 看面板；面板拉的接口是 `GET /api/context-guard/status`。

4. **调参**：在 profile 的 `cordis.patch.yml` 里按 id 覆盖（patch 是**整段替换**，不做深合并）：

   ```yaml
   - id: context-guard
     config:
       contextWindowTokens: 200000
       warnAt: 0.7
       errorAt: 0.85
   ```

## 卸载

```powershell
& $dsh plugin --profile desktop remove dsh-context-guard
# 或 plugin_manager: { "action": "remove_bundle", "target": "dsh-context-guard" }
```

会同步从 `dsh.profile.bundles` 里移除（管理器负责），重启 Desktop 后命令/面板/路由消失。

## 限制（重要）

- **Web 形态下宿主自带的 `auto` 自动压缩关不掉**：`@deepseek-ai/dsh-web-app` 层已把宿主平面的 `compaction-basic` 行设成 `disabled`，真正运行的实例藏在 `preset-standard` 条目的 `plugins` 里，bundle 层**无法按 id 命中**。要关 `auto` 必须在 profile 级 `cordis.patch.yml` 里对 `preset-standard` 做整段 config 覆盖（会连带把 preset roster 冻结成快照，直到 DSH 更新 preset 后重新复制；billion-context 的 `dsh.bundle.patch.yml` 注释记录了同一限制 DSH #2474）。本骨架不做这件事，只读测量。
- **第三方插件默认不能 `import '@deepseek-ai/*'`**：宿主包在 `app.asar` 内、只由 DSH 自己的 loader（锚在 asar 内）解析，不暴露给插件代码；本机 profile 的 `node_modules` 顶层没有 `@deepseek-ai`。想在插件里用 zod/schemastery 时，必须把它写进 `dependencies`（pnpm 的 hoisted 布局会提升到 profile `node_modules` 顶层），且那是**第二份**副本，不能拿去 `instanceof` 宿主里的类。详见 `research/sample-plugin.md`。
- `client.js` 的 `require('react')` 由平台共享模块表提供，不要打包 React。
- 本骨架未声明 `engines.dsh`（上架插件市场时补上，装前兼容性预检会读它；不合规时可 `dsh plugin --profile desktop allow-version ... --accept-risk` 授权）。
- `/ctx` 只读取 `ctx.tokenMeter.measure(session)`，不拦截、不修改会话；"主动压缩"需要另接 compaction seam 或替换 preset 行。

## 许可

MIT
