# DSH 第三方插件参考实现与最小骨架调研

> 目标：为「如何做一个 DSH 上下文长度管理插件」找出**现成可参考实现**，并交付一个能装进 DSH 的最小插件骨架。
> 范围：只读调研 + `plugin-skeleton/**` 与本文；没有改 `.probe/`，没有改用户 `~/.dsh` 配置。
> 文中 **✅ 已验证** = 有代码/实测出处；**🔶 推断** = 由已验证事实推出、未直接实测。

## 0. 结论（TL;DR）

1. **最值得抄的参考实现是 `billion-context`（0.1.197）**：它已解决"第三方插件如何在 DSH 里注册命令/工具/路由/设置面板、如何关闭宿主自动压缩"等全部接入问题。其接入面是 Cordis 对象插件 + `dsh.bundle.patch.yml` bundle 层 + `dsh.client` 浏览器半侧，**不 import 任何宿主包**。
2. **最小纯客户端模板是 `dsh-bloom-theme`**：`package.json` 的 `dsh` 字段 + `cordis.patch.yml` 里一行 `insert` + `lib/index.js` 一个空 `apply` + `exports["./client"]` 的浏览器 bundle。骨架的可安装性就是按它验证的。
3. **本地插件安装机制（已验证）**：`dsh plugin --profile desktop add <目录>`（底层 `pnpm add` → `link:`）→ 校验 `dsh.bundle.patch` → 把包名追加进 profile `package.json` 的 `dsh.profile.bundles`；`--dump-config` 能看到 `# == <包名>`  provenance 注释和插入行。Desktop 的插件页走同一套 `plugin-manager` operations。
4. **Web 形态下宿主 `compaction-basic` 的 `auto` 关不掉**（bundle 层按 id 命中不到 preset 内部实例），只能 profile 级整段覆盖 `preset-standard`。billion-context 的 patch 注释明确记录了 DSH #2474。
5. **第三方插件默认不能 `import '@deepseek-ai/*'`**（宿主包在 app.asar 内、只对 loader 的 row name 解析可见）；有条件可装第二份但**不能用来继承 `BasicCompactionEngine`**（详见第 8 节）。
6. 骨架已交付并离线验证：`static.mjs` 26/26、真实 Cordis 的 `smoke.mjs` 39/39、隔离 profile 的 `--dump-config` 证据。安装产物已清理，避免递归污染。

## 1. 环境与方法

| 项 | 值 |
| --- | --- |
| DSH 安装 | `C:\Users\40410\AppData\Local\Programs\DeepSeek Harness`，代码在 `resources\app.asar` |
| CLI | `C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（**不在 PATH**，`Get-Command dsh` 为空） |
| node | `C:\Users\40410\AppData\Local\pi-node\current\node.exe`（v22.23.3） |
| profile | `C:\Users\40410\.dsh\profiles\desktop` |

✅ 解包方法（现成脚本 `.probe/asar-index.mjs`）：

```powershell
node "C:\Users\40410\Desktop\context\.probe\asar-index.mjs" "<asar>" extract "dsh/node_modules/@deepseek-ai/<pkg>/*" "C:\Users\40410\Desktop\context\.probe\asar"
```

已解出：`dsh-token-meter`、`dsh-compaction`、`dsh-compaction-basic`、`dsh-commands`、`dsh-command-compact`、`dsh-package-manifest`、`dsh-plugin-manager`、`dsh-base`、`dsh-web-app`、`dsh-app-boot`、`cordis`、`cordis-plugin-loader`、`dsh-client-*` 等。

✅ `billion-context` 的 `dist/agent/dsh-native.js` 是压缩 bundle，但 `dist/agent/dsh-native.js.map` 带 262 个 `sourcesContent`，用 node 解出原始 TS（`src__agent__dsh-native.ts` 81352B 等）后可读。

## 2. 参考实现 A：billion-context 0.1.197（DSH 原生接入）

### 2.1 package.json 的关键字段 ✅

`C:\Users\40410\.dsh\profiles\desktop\node_modules\billion-context\package.json`：

```jsonc
{
  "name": "billion-context",
  "type": "module",
  "main": "dist/index.js",                  // CLI bin 用，不是宿主加载的入口
  "exports": {
    ".": "./dist/agent/dsh-native.js",      // ← 宿主 loader 加载的 node 半侧
    "./server": "./dist/agent/opencode-native.js",
    "./dsh": "./dist/agent/dsh-native.js",
    "./client": "./dist/agent/dsh-native-client.js",  // ← dsh.client 加载的浏览器半侧
    "./package.json": "./package.json",
    "./dsh/package.json": "./package.json"
  },
  "dependencies": { "zod": "4.1.8" },        // 唯一的运行期依赖（不是 @deepseek-ai/*）
  "engines": { "node": ">=20" },
  "dsh": {
    "bundle": { "patch": "./dsh.bundle.patch.yml" },
    "client": { "platform": "web" }
  }
}
```

要点：`exports["."]` 才是插件入口（`main` 只给 `bin` 用）；`dsh.bundle.patch` 让安装器把它当 profile 层；`dsh.client.platform: "web"` 让 `exports["./client"]` 被浏览器壳加载。

### 2.2 bundle patch 层 ✅

`billion-context\dsh.bundle.patch.yml`（原文注释保留了最关键的三条约束）：

```yaml
# Mounted automatically when the profile's package.json lists billion-context
# in dsh.profile.bundles (`dsh plugin --profile <name> add billion-context`);
# the loader resolves `name` from the profile's node_modules.
# #1772/#2474: the `auto: false` below targets the HOST-PLANE compaction-basic
# row. In profiles bundling @deepseek-ai/dsh-web-app that row is disabled and
# the running instance lives inside the preset-standard entry, which this
# bundle layer cannot address by id — switching off auto-compaction there
# needs a profile-level full-snapshot override of preset-standard (config
# replaces wholesale; see the plugin's boot warning / #2474).
- insert:
    - id: bili-native
      name: billion-context
- id: compaction-basic
  config:
    auto: false
# A patch replaces the targeted row's WHOLE config (no deep merge), so each
# row restates every default code plus MALFORMED_RESPONSE ...
- id: llm-deepseek
  config:
    retryPolicy:
      mode: normal
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, MALFORMED_RESPONSE]
- id: llm-deepseek-account
  config:
    retryPolicy: { mode: normal, retryableCodes: [/* 同上 */] }
```

✅ 从这些注释 + `dsh-app-boot` 源码验证到的 patch 语义：

- patch 文件根是 **YAML 序列**；`- insert:` 追加新行，其余按 `id` 覆盖已有行的 `config`（**整段替换，不深合并**）。
- 同一 `id` 再次 `insert` 会追加重复行而不是合并（所以 `bili-native` 只 insert 一次）。
- 命中不到的 `id` 会被跳过并告警（`dsh-app-boot` 里原文 `patch: name mismatch for %C (expected %C, got %C), skipping`），不会启动失败。
- bundle 层挂载条件：profile `package.json` 的 `dsh.profile.bundles` 列出包名；`name` 由 profile `node_modules` 解析。

### 2.3 node 半侧源码（sourcemap 还原）✅

`src/agent/dsh-native.ts`：

```ts
export const name = "bili-native";                 // L56
export const inject = ["tools", "commands", "agents"]; // L57
```

`PluginContext`（L112 起）列出的就是第三方插件在 DSH 里可用的**全部上下文面**：

```ts
tools:    { register(definition: ToolDefinition) }
commands: { register({ name, description, handler(invocation) }) }
agents:   { currentInitiator?(): AgentLike | undefined }
llm?:     { resolveModelInfo?(provider, model, signal) }
agentDefaultModel?: { currentSelection?() }
profileContext?: { startedBundles?: readonly string[] }
inject?(deps, callback)
effect?(fn, label?)
on?(event, listener)
sessions?: { get?, list? }
sessionTitle?: { get? }
webServer?: { register({ kind: "exact" | "prefix", path, handler }) }
```

它在这个文件里的用法（`apply` 从 L935 起）：注册 `/acp`、`/acp-cache` 两个命令；把代理侧的 `compress`/`decompress`/`acp_status` 工具 manifest 经 `ctx.tools.register` 注册成原生工具；`ctx.inject(["webServer"], sub => sub.webServer.register({ kind: "exact", path: "/bili/origin", handler }))`；`ctx.on("webserver/index-inject", ...)` 注入 `{ kind: "global", name: "__BILI__" }`；`ctx.on("session/created")` / `ctx.on("session/event")` 处理 `session/title`；最后 `installNativeFetchIntercept(globalThis.fetch)` 接管全局 fetch。

**结论（对方案最关键）**：

- ✅ billion-context **完全不 import 宿主包**。它的 `dsh-native.js` 里 `@deepseek-ai` 只出现 1 次，还是在字符串警告里（`"profile bundles include @deepseek-ai/dsh-web-app — ..."`）。
- ✅ 它**不是通过插件 API 关掉宿主压缩**，而是靠安装器 patch（把 `compaction-basic` 设 `auto: false`）——因为 DSH 没有 compaction 事件 hook。
- ✅ 它把"上下文压缩"做成自己的状态机 + 命令/工具，宿主侧只负责测量（`ctx.tokenMeter`）和 UI 槽位（浏览器半侧）。

### 2.4 浏览器半侧 ✅

`dsh-native-client.js`（9334B，未压缩）：

```js
window.__ModuleLoader__.load({
  id: "billion-context",                  // 必须等于包名（client-modules 的模块身份）
  factory: (require) => { var module = {exports:{}}; /* ... */ return module.exports },
})
// exports: { apply, inject }
var inject = ["slots", "locale"];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "bili: dictionaries")
  ctx.locale.bind(NS)
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register({ name: "settings.section", id: "bili", order: 100, label: () => t("nav"), locale: NS }, panel(true)))
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register({ name: "plugins.bundle.config", key: "billion-context", locale: NS }, panel(false)))
}
```

React 走平台共享模块表：`require("react")`（不打包 React）。这套「`__ModuleLoader__.load` + `inject ["slots","locale"]` + `settings.section` 槽位」就是骨架 `client.js` 的模板。

### 2.5 用户可见配置

包内 `CONFIGURATION.zh-CN.md` 描述的是"在 profile 层按 id 覆盖 `bili-native` 行的 config"（patch 整段替换语义），不是插件自带的配置文件。

## 3. 参考实现 B：dsh-bloom-theme 0.17.6（最小纯客户端插件）

`...\node_modules\dsh-bloom-theme\package.json` ✅：

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web", "immediately": true }
  },
  "devDependencies": { /* 只有 esbuild/typescript/@types/node，零运行时依赖 */ }
}
```

`cordis.patch.yml` ✅（注释是作者对机制的自述）：

```yaml
# 随包分发的 patch —— 由 package.json 的 dsh.bundle.patch 引用。
# 有了它，`dsh plugin add` 之后插件会被自动 insert 进 profile 的 boot graph，
# 用户不必再手动编辑 ~/.dsh/profiles/<profile>/cordis.patch.yml。
# awesome-dsh-plugin 的收录门槛也要求插件声明 dsh.bundle manifest。
- insert:
    - id: bloom-theme
      name: "dsh-bloom-theme"
```

`lib/index.js` ✅：node 半侧只做 `export const inject = ['webServer']; export { apply, name };`，`apply` 里 `ctx.effect?.(() => ctx.webServer?.register({ kind: 'exact', path: '/api/bloom/dsh-version', handler }))`。注释明确：**node 半边不做业务，只是让 `cordis-plugin-loader` 认得这个包**；真正的主题逻辑在 `lib/client.js`（184943B），经 `exports["./client"]` 由 `dsh.client` roster 加载。

> ⚠️ 注意：`readDshVersion()` 用 `createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')` 读版本，注释暗示"能读到"；**本机实测该 resolve 失败**（见 8.2），代码有 try/catch 回退，所以功能不受影响。这说明作者注释基于其本地开发环境，不能当作第三方插件可 import 宿主包的证据。

## 4. 参考实现 C：dshmarket 1.66.12（市场/管理宿主）

包结构 ✅：`lib/`（`index.js`、`profile.ts`、`install.ts`、`patch.ts`、`dsh-cli.ts`、`types/operations.js`、`settings.js`…）+ `client/client.js`（753758B 浏览器 bundle）+ `locale/` + `cordis.patch.yml` + `src/`。

`package.json` 关键字段 ✅：

```jsonc
{
  "dependencies": { "js-yaml": "^4.1.0", "undici": "^7.29.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-settings": "^0.1.0-rc.7 || ...",
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "peerDependenciesMeta": { "@deepseek-ai/dsh-settings": { "optional": true }, "@deepseek-ai/schemastery": { "optional": true } },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-theme"]
    }
  },
  "exports": { ".": "./lib/index.js", "./client": "./client/client.js", "./locale/*.json": "./locale/*.json", ... }
}
```

要点：

- ✅ `dsh.client.inject` 写的是 **DSH 官方插件包名**（浏览器壳里已注册的模块），不是 npm 依赖。
- ⚠️ 它声明了 `@deepseek-ai/*` 的 **peerDependencies**（部分 optional），说明"宿主提供这些包"是作者预期；但本机 profile 的 `node_modules` **顶层没有 `@deepseek-ai`**，且 `lib/settings.js:70` 有运行期 `import z from '@deepseek-ai/schemastery'` —— 该文件何时被加载未验证，但解析链上确实找不到它（见 8.2）。
- ✅ 市场侧的"一个插件包需要哪些字段"由 `@deepseek-ai/dsh-package-manifest` 的 README 规定：`name`/`version` 必填；`engines { node?, npm?, dsh? }`（`dsh` 是 DSH 版本 SemVer 范围）；`dsh.manifestVersion: 1`；`dsh.bundle.patch`（相对包根路径，或有序路径数组，同一组合包层按序应用）；`dsh.client`（如 `{ platform: "web" }`）。**包本身不校验，读取方各自解析**；当前加载器也不强制 `manifestVersion`/`engines.dsh`。

## 5. 宿主插件机制（做"上下文长度管理"必须知道的 seam）✅

### 5.1 服务面

| 服务 | 出处 | 关键 API |
| --- | --- | --- |
| `ctx.tokenMeter` | `dsh-token-meter`（`super(ctx,"tokenMeter")`，lib/index.js L691-692；`measure` L722） | `measure(session, requestHeader?)` → `{ totalTokens, surfaceTokens, nodes }`（深度只读快照；`surfaceTokens === Σ nodes[].tokens`；`totalTokens` 含请求+响应压力）；`estimateMessage(message)`；组合 `sessionProjections` 后还有 `tokenUsage`/`contextPressure`/`contextBreakdown` 三个投影。每次调用 O(surface)，会克隆表面节点 |
| `ctx.commands` | `dsh-commands`（CommandRuntime L215/L259，`register` L266，`execute` L327） | `register({ name, description, input?: { hint, attachments? }, handler: ({agent, rawInput, signal}) => {kind:'success', text?} \| {kind:'error', text} })`；命令名 `[a-z][a-z0-9_-]*`；handler 直接在 UI 命令面执行、不产生模型消息；注册返回 disposer |
| `ctx.webServer` | `dsh-app-boot`/插件注入 | `register({ kind: "exact"\|"prefix", path, handler(req,res) })` 返回 disposer |
| `ctx.compaction` | `dsh-compaction`（抽象 seam） | `compactIfNeeded` / `compactNow` / `compactRegion`；后端 `dsh-compaction-basic` 的 `static Config` 含 `auto`（`auto: config.auto ?? true`） |

✅ 压缩链路的真实形态（决定"能不能自动压缩"）：

- `dsh-base/cordis.patch.yml` 在 profile 根（host plane）有 `- id: commands`（L317）、`- id: token-meter`（L348）、`- id: compaction-basic`（L351）、`- id: command-compact`（L354）。
- `dsh-web-app/cordis.patch.yml` 把 host plane 的 `compaction-basic`（L536）、`command-compact`（L539）、`tool-result-pruner`（L542）等 `disabled: true`，注释原文：*"The token METER stays on the host plane; only the compaction backend that reads it moves."*
- `dsh-web-app/presets/standard.patch.yml` 里 `- id: preset-standard`（L5）的 `config.plugins` 内有一组 `- id: compaction`（L66，`cordis:group`, `group: true`, `isolate: { compaction: true, toolResultPruner: true }`），其 `config` 里才是真正运行的 `- id: compaction-basic`（L73-74）。
- ⇒ **`ctx.tokenMeter` 在 Web 形态可用；`ctx.compaction` 只在每个 agent 的 preset 子树里。bundle 层按 id 改不到 preset 内部的 `compaction-basic`。**

### 5.2 Cordis 插件契约（骨架必须满足）✅

`@deepseek-ai/cordis` lib/index.js：

- 插件 = 函数或对象（`{ name, inject, Config, apply }`）；`apply(ctx, config)`。
- `resolveConfig`（L956）：若插件导出 `Config`，用 `Config["~standard"].validate(config)` **同步**校验；`async` 会抛 `Async config validation is not supported`；issues 抛 `ValidationError`（格式 `invalid config:\n  - <message> (at <path>)`）。⇒ zod 4 / schemastery 3.18 满足；骨架用手写 Standard Schema 也可以。
- `ctx.inject(deps, cb)`、`ctx.effect(fn, label)`、`ctx.on(event, listener)` 都可用；`agent.session` 是 `tokenMeter.measure` 的入参类型（`compaction-basic` 里就是 `meter.measure(agent.session)`）。

## 6. 骨架交付（`C:\Users\40410\Desktop\context\plugin-skeleton\`）

`context-monitor-and-control` 0.2.0，零依赖 ESM，节点半边 + 浏览器半边完整：

```
plugin-skeleton/
├─ package.json                 # type/module/exports/main/engines + dsh.bundle.patch + dsh.client + files
├─ index.js                     # Cordis 插件：name/inject/Config(手写 Standard Schema)/apply
├─ dsh.bundle.patch.yml         # - insert: id context-monitor-and-control, name context-monitor-and-control
├─ client.js                    # __ModuleLoader__.load({id:'context-monitor-and-control', factory}) + settings.section 面板
├─ icon.svg                     # 原创占位图标（≤256KiB）
├─ locale/en.json, locale/zh.json  # meta.title / meta.description
└─ test/
   ├─ static.mjs                # 纯离线 26 项检查
   ├─ smoke.mjs                 # 真实 Cordis 39 项集成检查（需先 prepare-deps）
   ├─ prepare-deps.mjs          # 从 app.asar 离线解出 cordis/cosmokit
   ├─ resolve-probe.mjs         # 8.2 的解析探针（复现用）
   └─ dump-config-smoke.txt     # 隔离 profile 里 --dump-config 的实际输出（安装证据）
```

设计决定：

- **`index.js` 不 import 任何 npm 包**：本地目录安装是 `link:`，插件真实路径在 profile 之外（或插件目录），裸导入解析不到宿主依赖；只用 `ctx.*` 服务最稳。
- `inject = ["commands", "tokenMeter"]`；`/ctx` 命令用 `ctx.tokenMeter.measure(agent.session)` 取用量，按 `contextWindowTokens`/`warnAt`/`errorAt` 输出状态；`/ctx <n>` 用 `WeakMap` 临时覆盖本会话预算。
- `ctx.inject(["webServer"], sub => sub.webServer.register({ kind: "exact", path: "/api/context-monitor-and-control/status", handler }))`：无 Web server 的 profile 也能挂载；面板只读该 JSON。
- 配置校验是手写同步 Standard Schema（`Config["~standard"].validate`），因此**不需要 zod**。
- 卸载靠 `ctx.effect` / `register` 返回的 disposer，`smoke.mjs` 验证了卸载后命令注销。

## 7. 装法（两条，均经代码验证）

前提：打开过一次 Desktop 初始化 `~/.dsh/profiles/desktop`；装完重启 Desktop。

### 7.1 Desktop 插件管理（`plugin_manager` 工具）

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\context-monitor-and-control" }
```

`dsh-plugin-manager` 的工具 `plugin_manager` 支持 `list_plugins` / `list_bundles` / `set_plugin` / `set_bundle` / `install_bundle` / `remove_bundle` / `list_version_exemptions` / `set_version_exemption`（`lib/types/tools.js` L78）；`install_bundle` 的 target 是安装 spec（本地目录/包名/git/tarball），需要 `danger-full-access` 权限；失败返回 `nextStep`。

### 7.2 CLI

```powershell
$dsh = "C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "C:\path\to\context-monitor-and-control"
# 卸载
& $dsh plugin --profile desktop remove context-monitor-and-control
# 确认 bundle 层
& $dsh --profile desktop --dump-config
```

底层（`dsh-plugin-manager/lib/types/operations.js` 已验证）：

1. `runPluginCommand`：`mkdir profile` → `withFileLock(profile/package.json)` → 无 package.json 则 `initProfile`。
2. `runProfilePnpm`：保存 `package.json` + `pnpm-lock.yaml` 快照（失败/取消原样写回）；对具名 spec 做 manifest + `engines.dsh`/DSH peer 兼容预检；`execa('pnpm', [...args, ...args.map(anchorPathSpec)], { cwd: profileDir, stdio: 'inherit' })`。`anchorPathSpec` 只把 `.`/`..` 开头的相对 spec 转绝对，`file:`/`link:` 前缀保留，Windows 绝对路径原样传。
3. pnpm 退出 0 且未超时 → `reconcile`：对新增依赖 `resolveBundleDir('dsh', name, anchor, dir)` + `readProfileManifest`；**没有 `dsh.bundle.patch` 只作为普通依赖安装**并警告 `declares no dsh.bundle — installed as a plain dependency, not a profile layer`；有则 `loadOverlayPatches` 校验并 push 到 `dsh.profile.bundles`，`saveManifest` 原子写回。
4. 运行记录 `.plugin-manager/run.json`；日志 `.plugin-manager/logs/operation-*/pnpm.log`；诊断日志在 profile 的 `.plugin-manager`。

✅ 隔离实测（DSH_HOME 指向临时目录，profile 名 `smoke`，**已删除安装产物**）：

- `add` 成功输出 `+ context-monitor-and-control 0.2.0 <- ..\..\..\..`；
- profile `package.json` 出现 `"dependencies": { "context-monitor-and-control": "link:C:/Users/40410/Desktop/context/plugin-skeleton" }`，`dsh.profile.bundles` 末尾追加 `"context-monitor-and-control"`；
- `--dump-config` 末尾：
  ```
  # == context-monitor-and-control
  - id: context-monitor-and-control
    name: context-monitor-and-control
  ```
- 从 profile `package.json` 锚点 `require.resolve('context-monitor-and-control')` → `...\profiles\smoke\node_modules\context-monitor-and-control\index.js`，`import` 得到 `{ Config, apply, inject, name }`、`name: context-monitor-and-control`、`inject: ["commands","tokenMeter"]`；
- `remove` 后 `dsh.profile.bundles` 回落到 `["@deepseek-ai/dsh-base"]`（CLI 自动同步 manifest）。

> ⚠️ 安装实验的 profile 不要放在插件目录内部（`<插件>/test/dsh-home` 这种）：profile `node_modules` link 回插件目录、插件目录里又包含 profile → 自我引用无限嵌套（pnpm 的 `.ignored/context-monitor-and-control/test/dsh-home/...` 会越套越深）。本次实验产生过该污染，已用 `cmd /c rmdir /s /q` 清理（不跟随 junction/链接）。

### 7.3 验证清单（离线优先）

```powershell
node test/static.mjs          # 26/26
node --check index.js; node --check client.js
node test/prepare-deps.mjs    # 可选，解出 cordis 到 test/deps
node test/smoke.mjs           # 39/39
& $dsh --profile desktop --dump-config   # 看 `# == context-monitor-and-control`
```

重启 Desktop 后：发 `/ctx` 看输出；设置 → 上下文 看面板；`GET /api/context-monitor-and-control/status` 看 JSON。

### 7.4 Web 形态的硬限制（方案必须写清楚）

- 宿主自带自动压缩的 `auto` 在 Web 形态**关不掉**（bundle 层按 id 寻址不到 preset 内部实例）；要关只能 profile 级整段覆盖 `preset-standard`（patch 整段替换，roster 被冻结成快照，直到 DSH 更新 preset 后重新复制）。billion-context 的 `dsh.bundle.patch.yml` 原文记录 DSH #1772/#2474。
- 因此"上下文长度管理"插件应把宿主的 `ctx.tokenMeter` 当**读数来源**，把"何时压缩/压多少"做在自己的命令/状态机里（billion-context 的路线），而不是试图替换宿主 `BasicCompactionEngine`。

## 8. 关键问题：第三方插件能否 `import '@deepseek-ai/schemastery'` / `'@deepseek-ai/dsh-compaction-basic'`？

### 8.1 结论

**默认不能（无条件 import 会失败）；有条件可以"装一份第二副本"，但用它继承 `BasicCompactionEngine` 不可行，不建议作为 L3 方案。**

- **不能**：本机 desktop profile 的 `node_modules` 顶层**没有** `@deepseek-ai`；从任何插件代码真实路径出发 resolve `@deepseek-ai/dsh` / `schemastery` / `cordis` / `dsh-compaction-basic` 全部 `MODULE_NOT_FOUND`。
- **有条件能**：宿主包在 npm 上已发布（schemastery 3.18.5、cordis 4.0.5、dsh-compaction-basic 含 0.2.1-rc.1），若把它们写进插件 `dependencies`，profile 的 pnpm 布局（`nodeLinker: hoisted`）会把依赖提升到 `profile/node_modules` 顶层 → 从插件真实路径可解析。**那是与宿主不同的一份副本**，版本可能漂移，且 `instanceof`/服务标识不与宿主共享。
- **所以"继承 BasicCompactionEngine"不可行**：即使 import 到，它的 `ctx` 服务注册（`compaction`/`tokenMeter`）绑定的是那份副本自己的 Cordis 世界，宿主 agent 的 `ctx.compaction` 仍是宿主实例；DSH 的 loader 也只按 profile 解析到的模块加载 row（`name`），第三方代码不能把"类"注入进宿主的 preset 子树。正确路径是**用自己的包名占住 bundle 行 + 通过 `ctx.*` 服务面工作**（billion-context 的做法），或 profile 级整段覆盖 `preset-standard`（高风险）。

### 8.2 证据（复现见 `test/resolve-probe.mjs`）

1. ✅ profile 顶层清单（`C:\Users\40410\.dsh\profiles\desktop\node_modules`）：`.bin, .pnpm, @img, @types, argparse, billion-context, detect-libc, dsh-bloom-theme, dshmarket, js-yaml, semver, sharp, undici, zod` —— 无 `@deepseek-ai`，也无 `schemastery`。
2. ✅ `resolve-probe.mjs` 对 5 个锚点（profile `package.json`、bloom `lib/index.js`、billion-context `dist/agent/dsh-native.js`、dshmarket `lib/index.js`、骨架 `index.js`）测 5 个 spec：
   - `@deepseek-ai/{dsh/package.json,schemastery,cordis,dsh-compaction-basic}` → **全部 `MODULE_NOT_FOUND`**；
   - `zod` → 前 4 个锚点 `OK ...\node_modules\zod\index.cjs`（billion-context 声明了 `zod` 依赖，被提升到 profile 顶层）；骨架目录（不在 profile 内、无依赖）→ `MODULE_NOT_FOUND`。
3. ✅ bloom 的 `readDshVersion()` 用 `createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')`，**本机实测失败**，走 catch 回退；其注释"能读到"只在作者开发环境成立。
4. ✅ billion-context `dist/agent/dsh-native.js` 中 `@deepseek-ai` 只出现 1 次（字符串警告），零宿主 import —— 这是"跑通 DSH 接入"的实际做法。
5. ⚠️ dshmarket 声明 `peerDependencies: @deepseek-ai/{cordis, dsh-settings, schemastery}`（后两者 optional），但 `lib/settings.js:70` 有 `import z from '@deepseek-ai/schemastery'`；本机解析链上找不到该包（`peerDependencies` 只声明、不会自动装：profile 的 pnpm 配置 `autoInstallPeers` 未开启）。该文件何时被加载未验证；结论：**peer 声明 ≠ 运行时可解析**。
6. ✅ 宿主包只存在于 `app.asar` 内，由 DSH 自己的 `ModuleLoader`（锚在 asar 内部、Node 的 asar fs patch）解析——只对 loader 的 row `name` 生效，不暴露给第三方代码的裸 import。
7. ✅ 条件路径可行的机制证据：billion-context 声明 `zod 4.1.8` → 安装后 `zod` 出现在 profile `node_modules` 顶层并可被插件解析（pnpm `nodeLinker: hoisted`）。

### 8.3 如果仍想"复用"宿主实现

按风险从低到高：

1. **只读/命令/UI 层**（本骨架）：`ctx.tokenMeter`、`ctx.commands`、`ctx.webServer`、浏览器 `slots`/`locale` —— 零宿主 import，最稳。
2. **自己实现压缩状态机**：像 billion-context 一样把压缩做成工具/命令 + 自己的存储，通过 `ctx.llm`/`ctx.agents` 拿模型与会话信息。
3. **替换 preset 行**：profile 级覆盖 `preset-standard` 的 `plugins`，把自己实现的 compaction 行换进去（整段配置替换、roster 冻结；风险高，需随 DSH 版本维护）。
4. **继承 `BasicCompactionEngine`**：不推荐（第二份 Cordis/类副本、服务无法与宿主共享）。

## 9. 已验证事实 vs 推断

| 事项 | 性质 | 出处 |
| --- | --- | --- |
| `dsh plugin add <本地目录>` = pnpm `link:` + 追加 `dsh.profile.bundles`；无 `dsh.bundle.patch` 只装依赖 | ✅ 已验证 | `dsh-plugin-manager/lib/types/operations.js`（`runProfilePnpm` L299、`anchorPathSpec` L71、`reconcile` L96、`runPluginCommand` L591）+ 隔离 profile 实测 |
| patch 整段替换、insert 追加、按 id 覆盖、缺行跳过告警 | ✅ 已验证 | `dsh-app-boot`（`loadOverlayPatches`/`applyEntryPatches`、`resolveBundleDir`）+ billion-context patch 注释 |
| Web 形态 `compaction-basic auto` 关不掉（真正实例在 preset-standard 内） | ✅ 已验证 | `dsh-web-app/cordis.patch.yml` L536-542 + `presets/standard.patch.yml` L5/L66/L73-74 + billion-context 注释 #1772/#2474 |
| `ctx.tokenMeter.measure(agent.session)` 的返回形状 | ✅ 已验证 | `dsh-token-meter` README.zh + `compaction-basic` 的调用 + 骨架 smoke 实测 |
| `ctx.commands.register` 的 definition/返回值/disposer | ✅ 已验证 | `dsh-commands` L215/L259/L266/L327 + 骨架 smoke |
| 第三方插件默认无法 import `@deepseek-ai/*` | ✅ 已验证 | `resolve-probe.mjs` 全 `MODULE_NOT_FOUND` + profile 顶层清单 |
| 声明依赖后会被 pnpm 提升到 profile 顶层、可 import | ✅ 已验证 | billion-context 的 zod 在 profile `node_modules` 顶层被解析 |
| 继承 `BasicCompactionEngine` 可行/不可行 | 🔶 推断（强） | 由"第二份副本 + 宿主服务实例不共享 + loader 只按 profile name 加载行"推出；未实测继承 |
| Desktop 插件页与 CLI 走同一 operations 层、HMR 热生效 | 🔶 部分推断 | README 记录 + `plugin_manager` 工具实现；CLI 安装后是否无需重启未实测（本机重启验证未做） |
| billion-context 的 `session/title`、`webserver/index-inject` 等事件名 | ✅ 已验证（源码） | `dsh-native.ts`（sourcemap `sourcesContent`） |
| DSH 没有 compaction 事件 hook | ✅ 已验证 | `dsh-compaction` 抽象仅提供操作 API；billion-context 只能靠 installer patch 关 auto |

## 10. 未解决 / 风险

- `preset-standard` 整段覆盖会冻结 roster（billion-context 注释）；不同 DSH 版本需重新复制，属版本敏感方案。
- Desktop 运行中手工 CLI 安装能否 HMR 热生效未实测（重启最稳）。
- 骨架默认 `contextWindowTokens: 128000` 是常量，真实预算应由 `ctx.llm.resolveModelInfo()` 的 `context.contextWindow` 提供（billion-context 就这么做）；骨架里保守地用配置值，可作 TODO。
- 本骨架未实现"自动触发压缩"；若要，需要接 `ctx.compaction`（preset 子树内）或自己的状态机。
- dshmarket 的 peer 声明与运行期 `import '@deepseek-ai/schemastery'` 的矛盾未深入追踪（不在本任务范围）。
