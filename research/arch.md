# DSH（DeepSeek Harness）插件开发机制调研

> 调研对象：`C:\Users\40410\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（Electron asar，182 MB）
> 解包工具：`C:\Users\40410\Desktop\context\.probe\asar-index.mjs`，提取根 `C:\Users\40410\Desktop\context\.probe\asar\`
> 用户 profile：`C:\Users\40410\.dsh\profiles\desktop`
> 本文中所有形如 `.probe/asar/...` 的路径都相对于工作目录 `C:\Users\40410\Desktop\context`。
> 标注约定：**【已验证】** = 有官方 README/源码片段出处；**【推断】** = 由代码结构推出、未在文档中明说。

---

## 0. 结论速览（先看这 10 条）

1. **DSH 插件 = Cordis 插件 + 可选「组合层声明」+ 可选「浏览器半侧」。** 三者正交：没有 `dsh` 字段的包是纯 Cordis 插件（不会进 profile 组合）；有 `dsh.bundle.patch` 就能进 `dsh.profile.bundles` 成为「bundle」；有 `dsh.client` 就额外拥有一个浏览器端 bundle。
2. **Cordis 插件只有三种合法导出形态**：函数 `(ctx, config)`、类 `new (ctx, config)`、对象 `{ apply(ctx, config) }`；元数据挂在它身上：`name` / `Config` / `inject` / `provide` / `intercept`。见 `cordis/src/registry.ts:92-133`。
3. **`Config` 是 StandardSchema（DSH 用 `@deepseek-ai/schemastery`）**，在插件**激活时**对 Loader 行的 `config` 做校验，校验发生在 `apply` 之前。见 `dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md:64`。
4. **一切副作用必须挂在 `ctx.effect()` / `ctx.on()` 上**，返回清理器；宿主靠这个在插件被停用、热替换、或 profile 重组合时把资源收干净。
5. **bundle patch 的 DSL 只有两类操作**：`insert: [rows]` 追加行；`- id: <已有行>` + 部分字段**按 id 覆写**。覆写时 **`config` 是整体替换、绝不深合并**（这是最容易踩的坑）。
6. **组合顺序（低 → 高优先级）**：各 bundle 的 patch（按 `dsh.profile.bundles` 顺序）→ profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 启动参数 `--patch` 覆盖层。后者覆盖前者。见 `dsh-app-boot/README.zh.md:61` 与 profile 里 `cordis.yml` 的注释。
7. **第三方包进 `bundles` 的三个硬条件**：①有合法 `package.json`；②`dsh.bundle.patch` 指向存在的 patch 文件（或有序文件列表）；③patch 里 `insert` 行的 `name` 能被 Node 从 profile 目录解析到。满足就能出现在 `dsh.profile.bundles`。
8. **Web UI 扩展点走 `ctx.slots`**：`ctx.slots.inject(<slot 名>, () => ctx.slots.register({name, id, order, label, locale, inject, children}, Component))`。宿主半侧只需 `export function apply() {}`（空实现，仅占一行 Loader 行）。
9. **做「上下文长度管理」面板，官方与第三方都选 `settings.section`**（设置页里一个分区页）；第三方 `billion-context` 的实现是现成范本，见 `billion-context/dist/agent/dsh-native-client.js:245-252`。
10. **官方明确反对手改 profile 文件**：正确姿势是「在工作区写一个 bundle 目录 → `plugin_manager` 工具 `install_bundle`（target 为绝对目录）」。见 `.../cordis-plugin-development/SKILL.md:8,10`。

---

## 1. 三层结构：插件 / bundle / 客户端半侧

```
profile 目录 (.dsh/profiles/<name>/)
  package.json          → dsh.profile.bundles: [官方 bundle, 第三方包, ...]   ← 选择层
  cordis.yml            → 恒为 []（根条目列表，被 patch 组合）                ← 空根
  cordis.patch.yml      → 用户 tweak 层                                      ← 覆盖层
        │
        ├─ bundle A 的 dsh.bundle.patch.yml（insert 行 / 按 id 覆写）
        ├─ bundle B 的 dsh.bundle.patch.yml
        ├─ profile/cordis.patch.yml
        ├─ $DSH_HOME/cordis.patch.yml
        └─ --patch <file>  （每次启动的覆盖层，最高优先级）
        ↓
  Loader EntryTree（cordis-plugin-loader）
        ↓ 每一行 = 一个 Cordis 插件实例
  Host 侧 ctx 服务树（fs / tools / llm / session / tokenMeter / compaction / webServer ...）
        ↓ 其中声明了 dsh.client 的包
  dsh-client-modules 扫描 → 组合 window.__DSH_BOOT__ → /plugins/??...bundle
        ↓
  浏览器 window.__ModuleLoader__.load({ id, factory }) → ctx.slots 注册 React 组件
```

**【已验证】** profile 的 `cordis.yml` 原文自带注释：

```yaml
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
```
（`C:\Users\40410\.dsh\profiles\desktop\cordis.yml`）

**【已验证】** `dsh-app-boot/README.zh.md:61`：「**`cordis.patch.yml`——你的 tweak 层，应用在所有组合包层之后（先应用逐 profile 的文件，再应用 home 级文件，因此后者优先级更高）：替换某个条目的整个配置（重述你要保留的字段）、插入新条目，或在启动时插值 `!!js` 表达式。patch 指定的条目不存在时输出 stderr 警告；空文件或仅含注释的文件会导致启动失败——如需禁用该层，请改用 `[]`**。」

**【推断】** 「bundle」不是一种特殊包类型，而是**关系**：一个包之所以是 bundle，只因为它被写进了 `dsh.profile.bundles` 且声明了 `dsh.bundle.patch`。同一个包既可以是某 profile 的 bundle，也可以被别的包 `import` 当普通库用（DSH 官方包都是这种双身份）。

---

## 2. Host 侧：Cordis 插件怎么写

### 2.1 三种合法形态与元数据归一化

`cordis/src/registry.ts:92-146`（原文）：

```ts
/** Supported plugin entrypoint shapes. */
export type Plugin<T = any> = Plugin.Function<T> | Plugin.Constructor<T> | Plugin.Object<T>

export namespace Plugin {
  export interface Base<T = any> {
    /** Display name used for fiber diagnostics and logger names. */
    name?: string
    /** Standard-schema validator applied to config before the plugin starts. */
    Config?: StandardSchemaV1<any, T>
    /** Services the plugin requires; it only loads while all are available. */
    inject?: Inject
    /** Service name(s) the plugin provides (read by `Service` and by loaders). */
    provide?: string | string[]
    /** Service names whose intercept config the plugin declares it consumes. */
    intercept?: Dict<boolean>
  }
  export interface Function<T = any> extends Base<T> { (ctx: Context, config: T): any }
  export interface Constructor<T = any> extends Base<T> { new (ctx: Context, config: T): any }
  export interface Object<T = any> extends Base<T> { apply(ctx: Context, config: T): any }
}
```

解析逻辑（`registry.ts:8-10, 222-228`）：

```ts
function isApplicable(object: Plugin) {
  return object && typeof object === 'object' && typeof object.apply === 'function'
}
resolve(plugin: Plugin): Function | undefined {
  try {
    if (typeof plugin === 'function') return plugin
    if (isApplicable(plugin)) return plugin.apply
  } catch {}
}
```

结论：**注意 `export default class Foo extends Service` 也走「构造函数」这条分支**；对象形态则取 `.apply` 作为 registry 身份键（同一 `apply` 函数 = 同一插件运行时）。`plugin.name === 'apply'` 会被当成"没名字"（`registry.ts:324-325`），所以**具名导出建议 `export function apply`**，别指望它当显示名——显示名用 `export const name`。

### 2.2 官方 README 给的最小 Host bundle（原文，可直接抄）

`dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md:3` 先说定义：「**A bundle is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch inserts plugin entries.**」

同文件给出的最小 `package.json`（原文，见该 reference 的 Host-only bundle 清单段）：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

对应 patch：

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

Host 插件导出形式（同上文件）：`export function apply(ctx, config) {}` + 可选 `export const inject = ['tools']` + 可选 `export const Config`；**或者**默认导出 service class；两种不要混用。
`host-plugin.md:64`：「**Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup. A plugin that declares `Config` validates the row's `config` at activation.**」

### 2.3 一个真实的官方 Host 插件（可运行样例）

`dsh-client-ui-settings/lib/index.js`（全文仅 868 B，官方包，直接可读）：

```js
import z from "@deepseek-ai/schemastery";
const DeveloperToolsSettingsFields = { enabled: z.boolean().default(true) };
z.object(DeveloperToolsSettingsFields);
/** Live preferences projected to the browser. */
const Config = z.object({ enabled: DeveloperToolsSettingsFields["enabled"].volatile() });
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}
export { Config, apply };
```

要点：
- **`schemastery` 就是 DSH 的 Config schema 库**（`@deepseek-ai/schemastery`），`z.object({...})` + `.default()` + `.volatile()`。
- `volatile()` 的语义见 `cordis-plugin-loader/README.md:53`：**仅 volatile 字段变化时 Loader 就地提交新值、不重启插件**（会发 `loader/volatile-update`）；其它字段变化会 remount。做"可调参数"时，面板上频繁滑动的数值适合 volatile。
- **可选依赖用 `ctx.inject([...], cb)` 而不是 `inject: [...]`**：前者在服务缺失时插件保持 inactive（不报错），后者是硬依赖。
- `child.effect(fn)` 返回 disposer，整个调用被挂到父 fiber 上。

### 2.4 `inject` / `ctx.inject` 与生命周期

`cordis/src/registry.ts:12-24` 定义依赖声明类型：

```ts
/** Array form requests services without intercept config. Object form maps each
 *  service name to optional intercept config for the plugin context. */
export type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }
```

`registry.ts:293-302`：`ctx.inject(deps, callback)` 是 `ctx.plugin({ inject, apply: callback, name: callback.name })` 的语法糖 —— **"回调会被卸载并在依赖服务变化时重跑"**。

`inject` 的三种关系（**已验证**，`cordis` 官方 README 与 `service.ts`）：
| 写法 | 语义 |
|---|---|
| `export const inject = ['tools']` | 硬依赖；服务不在 → fiber 不激活，插件不运行 |
| `ctx.inject(['settings'], child => …)` | 软依赖；缺失时该子 fiber 保持 inactive，插件其余部分照常运行 |
| `export const Config = z.object({...})` | 配置校验；不满足 → 激活失败并报诊断 |

`ctx.effect` 的契约（`cordis/src/fiber.ts:402-418` 注释）：

```
* `execute` runs immediately; the disposers it produces are collected and
* run (in reverse order) either when the returned disposer is called or
* when the fiber unloads, whichever comes first. Calling the disposer twice
* is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
* already disposed, and `TypeError` if `execute` returns an invalid shape.
```

即：`ctx.effect` 的函数体**立即执行**，返回的清理器按**逆序**在 fiber 卸载时运行；fiber 已卸载时再调用会抛 `INACTIVE_EFFECT`。`ctx.on(...)` 在 `events.ts:288`，其注册本身也被包在 fiber effect 里（`events.ts:256`）。

### 2.5 Service 类

`cordis/src/service.ts:11-59`：`class Foo extends Service` 在构造函数里 `super(ctx, 'fooName')`，立即在 `ctx` 上注册为服务，**随所属 fiber 自动注销**。DSH 里所有 `ctx.fs`、`ctx.llm`、`ctx.tokenMeter`、`ctx.compaction`、`ctx.webServer` 都是这样来的。自定义服务时，消费方通过 `inject: ['yourService']` + `Context` 的声明合并（`declare module 'cordis'`）获得类型。

隔离与拦截（`context.ts:99-145`）：`ctx.extend(meta)` / `ctx.isolate(name, label)` / `ctx.intercept(name, config)`，用于「同一服务名在不同 realm 下不同实现」以及「插件为某服务追加配置」。官方 skill 提醒：**提供服务的插件必须与所有消费方用同一个 realm `isolate`**（`editing-cordis-compositions/SKILL.md`）。

---

## 3. 清单规范：`dsh` 字段全解

类型声明在 `dsh-package-manifest`（**该包只有类型、无运行时**：`lib/index.js` 仅 11 字节；README 明说"消费方读取并校验所需的 JSON 字段……本包不提供解析器、getter helper、文件检查或默认值"，`README.zh.md:92`）。

### 3.1 字段表

**【已验证】** `dsh-package-manifest/README.zh.md:46,50-55`：

| 字段 | 语义 |
|---|---|
| `dsh.manifestVersion` | manifest 格式标识，当前声明为 `1`，与 npm 版本、Session 格式版本无关 |
| `dsh.bundle.patch` | **patch 文件路径，或有序路径列表，均相对包根目录**；launcher 按列表顺序把它们作为**同一个组合包层**应用 |
| `dsh.client` | 浏览器半侧声明（见 3.2） |
| `engines.dsh` | 作者声明的兼容 DSH 版本（SemVer 范围，可填精确预发布版本）；与 `engines.node` 并列 |
| `engines.node` | Node 版本要求 |
| `icon` / `exports["./icon"]` | 展示图标：SVG/PNG/JPEG/WebP，≤256 KiB，必须在包内 |
| `locale/*.json` | 展示元数据 `meta.title` / `meta.description` |
| `files` | 要含全部运行时文件；**本地目录安装是 link 检出，`files` 不过滤链接目录** |

**注意一处自相矛盾（值得记录）**：`dsh-package-manifest/README.zh.md:93` 说「**当前安装器和加载器不强制检查 `dsh.manifestVersion` 或 `engines.dsh`**」，但 `dsh-app-boot/README.zh.md:52` 说「**profile 导入插件前，DSH 会将其声明的 DSH 版本要求与 `getDshRuntimeVersion()` 返回的唯一运行时版本比较。清单声明了 `engines.dsh` 时，只由该范围决定，忽略 `peerDependencies`；否则 `peerDependencies` 中对 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 的每个范围都必须匹配**」。**以 app-boot 为准**（它是实际执行启动的包，其文档描述了 plugin-manager 的 `incompatible-version` 错误码），`dsh-package-manifest` 那句多半是过期描述。**【推断】** 但**实际影响很小**：写第三方插件时**不要写 `engines.dsh`**（不写就不检查），实测 `billion-context` 就完全没写。

### 3.2 `dsh.client` 四个键 + 校验代码

**【已验证】** 校验函数全文，`dsh-client-modules/lib/index.js:62-76`：

```js
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	const decl = value;
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return {
		platform: decl.platform,
		...(inject !== void 0 ? { inject } : {}),
		...(external !== void 0 ? { external } : {}),
		...(decl.immediately !== void 0 ? { immediately: decl.immediately } : {})
	};
}
```

| 键 | 必填 | 语义 |
|---|---|---|
| `platform` | **是**（字符串） | 目前官方用法只有 `"web"`；壳持有的载体（桌面）另有取值（`dsh-client-modules/README.zh.md:12`：「可用的 Web 载体通过 `/plugins` 提供每个 bundle，由 shell 持有的载体则通过 `fetchBundle()` 分派完全相同的 bundle 响应」） |
| `immediately` | 否 | `true` = 页面启动时就物化该 bundle；默认惰性（首次 import/被使用时才执行 factory） |
| `inject` | 否 | 必须是本 bundle 依赖的**其它客户端包名**数组；组合阶段保证提供方先于消费方加载（`README.zh.md:34`） |
| `external` | 否 | 基座模块表之外的运行时 import（`require('xxx')`）；裸包名指「另一条动态包 row」，否则必须是静态表键；**纯类型 import 被擦除、不产生请求**；自引用会报错（`lib/index.js:435`） |

`dsh.client` 还必须配 `exports["./client"]`，否则启动期抛错（`lib/index.js:171-181, 732-738`）：

```js
/** Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms. */
const client = exportsField["./client"];
...
throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`);
...
if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
```

### 3.3 官方客户端插件的 `package.json` 结构（可直接抄）

`dsh-client-ui-settings/package.json`（原文摘录）：

```json
{
  "name": "@deepseek-ai/dsh-client-ui-settings",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":            { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":     { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": { "client": { "inject": ["@deepseek-ai/dsh-api-remotes"], "platform": "web" } },
  "files": ["locale/*.json", "lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"]
}
```

注意它**没有** `dsh.bundle.patch`——因为它作为官方 bundle 的既有行被使用，不需要自己插行；第三方包则必须自带 patch。

---

## 4. bundle patch DSL（组合层）

权威文档：`dsh-agent-preset/skills/cordis-composition-reference/SKILL.md`（29 行）。核心规则：

### 4.1 两种操作

```yaml
# ① 追加行
- insert:
    - id: bili-native            # 行 id，全局唯一，供后续按 id 覆写
      name: billion-context      # 包 specifier；相对路径以 patch 文件所在目录为基准
      config: {}                 # 可选，交给插件 Config 校验
    - id: another
      name: '@local/another'
      disabled: false            # 可选

# ② 按 id 覆写已有行（来自更早的层）
- id: llm-deepseek
  config:
    retryPolicy: { ... }         # ⚠ 整体替换该行的 config，不是深合并
```

规则细节（**已验证**，同文件）：
- patch 是一个 **mapping**（不是 list）：`insert` / `id` 二选一。**非 insert 且无 id、或 id 匹配不到任何现有行 → 只告警并跳过，不使启动失败。**
- 有 `id` 无 `insert` 时，供给的字段**替换该行字段**；`config` 整体替换；truthy 的 `name` 只用来**断言**名字，不改名。
- 行字段全集：`id`、`name`、`config`、`disabled`、`inject`、`intercept`、`isolate`、`group`。
- `insert` 的 id 若指向一个已存在的 `group: true` 行，则插进该 group 的 `config` 列表（嵌套）。
- `group: true` + `name: cordis:group` → 该行 `config` 成为嵌套条目列表；`cordis:include` → 从 `config.path` 载入 YAML/JSON 条目列表。
- `disabled` 接受 `true` / `false` / `null` / `!!js` 表达式（如 `disabled: !!js process.platform === 'win32'`）。
- `!!js`（两个感叹号，不是 `!js`）是 Loader 表达式：在 config 内、该行声明的注入激活之后，**针对该插件的 ctx 求值**；行其它元数据保持字面量。例：`config: { dir: !!js dshHomePath('sessions') }`、`disabled: !!js "!ctx.get('profileContext')"`。
- `isolate` 把服务名映射到 `true` 或 realm 标签。

### 4.2 真实第三方 patch（billion-context，含作者踩坑注释）

`C:\Users\40410\.dsh\profiles\desktop\node_modules\billion-context\dsh.bundle.patch.yml` 的三段结构（注释为包作者原文摘要）：

```yaml
# ① 把自己的 Host 插件插进树
- insert:
    - id: bili-native
      name: billion-context

# ② 关掉内置自动压缩
- id: compaction-basic
  config:
    auto: false
# 注释大意：这一行在 profile 里由 @deepseek-ai/dsh-web-app bundle 引入，
# 但该 bundle 在 preset-standard 条目里又挂了一份 compaction-basic 实例；
# bundle 层无法按 id 定位到 preset 内部的条目，要关必须整体覆写 preset-standard。

# ③ 覆写 LLM 重试行
- id: llm-deepseek
  config:
    retryPolicy: { ... }   # 注释：patch 替换整个 config，所以把全部默认 code 重述了一遍
- id: llm-deepseek-account
  config:
    retryPolicy: { ... }   # 注释：不存在的行会告警并跳过，绝不会导致启动失败
```

**【结论】** 这三段恰好示范了 bundle 作者的三种典型动作：**插自己的行 / 按 id 调内置行 / 处理"行藏在 preset 里定位不到"这个问题**。最后一条对「上下文长度管理」很可能也成立：内置压缩插件在 `dsh-web-app` 的 `preset-standard` 配置里有一份实例，想改它就得在 profile 层整体覆写 `preset-standard` 的 config（【推断】，需在写方案时用 `dsh --profile desktop --dump-config` 核实实际行树）。

### 4.3 合并顺序（权威）

- profile/cordis.yml 注释：bundles → cordis.patch.yml → `--patch` overlays。
- `dsh-app-boot/README.zh.md:61`：所有组合包层之后是 `cordis.patch.yml`；**先 profile 文件、再 home 级文件，故 home 更高**。
- `cordis-plugin-development/SKILL.md:34`：`dsh --profile "$DSH_PROFILE" --dump-config` 打印组合结果。

→ 完整优先级（低到高）：**bundles 列表顺序 → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` 覆盖层**。**【推断】** 同一层内，`insert` 的行按出现顺序；同 id 后出现的覆写先前出现的。

---

## 5. 安装、加载与调试

### 5.1 安装一个第三方 bundle 的三条路（按推荐度）

| 方式 | 操作 | 出处 |
|---|---|---|
| **① 工具安装（官方推荐）** | `plugin_manager` 工具 `action: install_bundle`，`target` = **包目录的绝对路径**（或 registry spec / git URL / tarball） | `cordis-plugin-development/SKILL.md:8`；`dsh-plugin-manager/README.zh.md:48,52` |
| ② CLI | `dsh plugin --profile <name> add <spec>` | `dsh-base/README.zh.md`；`plugin-manager/README.zh.md:75` 给了 `dsh plugin --profile <p> version-exemptions / allow-version / revoke-version` |
| ③ 手写 profile（**官方明确反对**） | 改 `package.json` 的 `dsh.profile.bundles` + 手写 `cordis.patch.yml` | `SKILL.md:10`：「**Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`, or run pnpm in the profile directory**」 |

安装的实质（**已验证**，`plugin-manager/README.zh.md:50,52,98）：
- 发布版 DSH：装 `package@<当前 DSH 版本>`（`saveExact: true`）。
- 源码/开发版 DSH：装 `link:<工作区包的绝对目录>`，用该 checkout 的依赖与 peer；**代码改了要重新 build + 重启**。
- 安装 = ①`pnpm add` 写进 profile 的 `package.json` → ②**选入** `dsh.profile.bundles`（默认启用，追加到列表末尾）→ ③重新组合 profile 并激活。
- 失败/取消会恢复 `package.json` 与 `pnpm-lock.yaml`。
- **本地目录 = link 检出**（`file:`/`link:` 都按 profile 目录解析成绝对路径）。

### 5.2 加载流程与「什么要重启」

`dsh-client-modules`/`dsh-hmr` 文档共同描述的机制（**已验证**）：
- 每条 Loader Entry 由 `cordis-plugin-loader` `import(name)` 得到 module namespace，再归一化成插件（见 2.1），按 `config` 校验后启动 fiber。
- **HMR 默认开着**：`dsh-hmr/README.zh.md:27`：「启动器提供 `profileContext` 时，base 组合包以 `root: []` 启用 HMR；没有该 profile 上下文的宿主保留此条目为禁用状态。」配置项 `base`/`root`/`ignored`/`debounce`（`:38-47`）。
- `dsh-hmr/README.zh.md:49`：**HMR 的 profile 监听 + Plugin Manager 触发的重组合，会替换 profile 目录下（含 `node_modules`、含已链接包目标）磁盘上已变化的插件文件**——所以对一个 link 安装的本地插件，改完文件（重新 build 后）**通常不用重启**。
- 但下列情况要重启：**替换已安装包**（`host-plugin.md`：「新装 bundle 可通过 HMR 激活；替换已安装包需重启」）、在没有 HMR 的宿主里改组合、Loader 结算不了的变化（`restartReason: 'package-moved'` 等，`plugin-manager/README.zh.md:100`）。
- **客户端 bundle 必须构建后才生效**：`dsh-client-modules/README.zh.md:55`：「**宿主提供的是已构建的客户端 bundle，因此启动前 `pnpm run build` 必须已产出每个 `lib/client.js`；缺失 bundle 会明确导致激活失败，并给出一条构建说明及包／路径列表**」。HMR 按 `mtimeMs/ctimeMs/size` 派生 revision（`:79`），**只改元数据也可能重载**。

### 5.3 看日志/报错的地方（按排查顺序）

1. **启动期组合结果**：`dsh --profile <p> --dump-config`（`SKILL.md:34`）。**这是核对"我的行到底插进去没有、config 是什么"最快的办法。**
2. **启动失败**：`boot()` 失败时抛 `StartupError`，消息分组列出所有失败插件与**等待中的服务**（`app-boot/README.zh.md:96,143-146`）；`installFailLoud` 会向 **stderr** 写一条带标签的 `util.inspect` 诊断后退出（`:43`）。
3. **插件 import/激活错误**：`plugin_manager` `list_plugins` 的 `fiberPhase` / `failed` 状态；`list_bundles` 的 `error` 字段（`plugin-manager/README.zh.md:42`）。
4. **安装过程**：`plugin-manager/install-log` 事件流式转发 pnpm 输出；`plugin-manager/install-state` 通告 `installing`/`cancelling`/`applying`（`:60`）。完整输出落在返回的日志路径；操作记录在 `<profile>/.plugin-manager/run.json`（`:102`）。
5. **浏览器侧**：设置 → 插件 → 插件列表显示"当前页面的同步失败"并可重试（`dsh-client-modules/README.zh.md:42`）；模块系统按 row 记录最后一次 import 失败（传输/注册/依赖级联/factory 执行）（`:38`）。
6. **插件自己的日志**：`ctx.logger.info/warn/error`（cordis 内置 LoggerService，`context.ts:27-28`）。

---

## 6. 浏览器侧（Web UI）扩展点

### 6.1 加载机制

- 宿主半侧**增量扫描已启用的 Loader 条目**，读它们的 `package.json.dsh.client`，把每个声明变成 `/plugins/??<pkg>/client.js&rev=<rev>` 组合脚本，并把启动图以 `window.__DSH_BOOT__` 注入 index（`dsh-client-modules/README.zh.md:12,69`）。
- 浏览器里 `window.__ModuleLoader__` 是 queue facade：`load({ id, factory })` **只注册 factory**，模块副作用（含 CSS 注入）在**物化（首次 import/使用）时才跑**（`:38,73`）。
- **`id` 必须等于包名**（`ui-plugin.md:9`：「The browser artifact registers a lazy factory whose id equals the package name」）。
- **React 来自浏览器模块表**（`PLATFORM_MODULES`），`require('react')` 即可，**不要**自带 React / CDN / UMD（`ui-plugin.md:9`；`README.zh.md:51`）。
- 硬性约定（`cordis-plugin-development/references/practices.md`）：**不要 `require('@deepseek-ai/dsh-client-ui-primitives')`**；UI 必须用 `--dsw-alias-*` 主题 token。

### 6.2 `ctx.slots` API（这是 UI 扩展的唯一切入点）

签名（从官方与第三方用法反推，出现形式完全一致）：

```js
ctx.slots.inject(<目标 slot 名>, () => ctx.slots.register(options, Component))
```

`options` 合法键（**已验证**，出现在 `dsh-client-ui-settings-models/lib/client.js:4484-4497`、`ui-settings-shell/lib/client.js:182-190`、`plugin-manager/lib/client.js:4413-4456`、`billion-context/dist/agent/dsh-native-client.js:245-252`）：

| 键 | 语义 |
|---|---|
| `name` | 目标 slot 名（必须与 `inject` 的名字一致） |
| `id` | 该贡献的唯一 id（同 slot 内唯一） |
| `key` | keyed slot 用：把贡献挂到某条具体记录上（如 `plugins.bundle.config` 的 `key: "<包名>"`） |
| `order` | 排序（数字，小的在前） |
| `label` | 标签文案或 `() => t('nav')` |
| `locale` | 字典命名空间（配合 `ctx.locale.register(NS, {zh,en})`） |
| `inject` | `() => props`：组件拿到的 props 工厂；也可写成 `function* ()`（生成器，用于内部 `yield` 注册/清理） |
| `children` | 声明本 slot 事件拥有的子 slot：`{ "<slot名>": { kind: "list"\|"keyed"\|"single", scope: "root" } }` |
| `store` | 页面级 store（导航等） |

**父 slot 的 `children` 声明是硬门槛**：`renderSlot("settings.section", props, { only: id })` 只在父组件声明过该子 slot 时才渲染（`dsh-client-ui-settings-general/lib/client.js:337`、`plugin-manager/lib/client.js:2681,2739`）。所以**可挂载的 slot 名是封闭集合**，由已安装 UI 包声明；用 `cordis_inspect_query` 的 `Slots` 查询（`Slots.listSubTree`）枚举，别猜（`ui-plugin.md:11`）。

**已知可用的 slot（已从源码确认存在）**：

| slot | 用途 | 出处 |
|---|---|---|
| `settings.section` | 设置对话框里新增一个分区页（带左侧导航项） | `ui-settings-general/lib/client.js:337,1140-1155`；`ui-settings-models/lib/client.js:4485`；`billion-context` 用它 |
| `settings.plugins.tab` | 「内置插件」设置分区里的一个标签页 | `dsh-client-ui-settings-plugins/README.zh.md:30` |
| `settings.onboarding` | 首次使用引导步骤 | `ui-settings-models/lib/client.js:4502,4508` |
| `plugins.item` | 侧栏「插件」页里的一张配置卡片 | `ui-settings-shell/lib/client.js:182-190`；`plugin-manager/lib/client.js:4432` |
| `plugins.bundle.config` / `plugins.row.config` | keyed：把配置面板挂到某个具体 bundle/行下 | `plugin-manager/lib/client.js:4445-4453`；`billion-context` 用 `plugins.bundle.config` + `key` |
| `main` | 主区域一个完整页面（keyed，如插件页本身） | `plugin-manager/lib/client.js:4413-4432` |
| `sidebar.panellist` | 侧栏导航图标（配合 `main`） | `plugin-manager/lib/client.js:4459-4466` |
| `shell.overlay` | 全屏覆盖层 | `plugin-manager/lib/client.js:4404`；`ui-plugin.md:11` |
| `conversation.composer.dock` | 输入框下方装饰区（最简单） | `ui-plugin.md:11`；decoration 模板 |
| `conversation.chat.node` | 聊天流里插入自定义节点 | `practices.md` |

### 6.3 Host → Client 数据通道（两条，都有真实样例）

**通道 A：`webServer` 自注册 HTTP 路由 + 浏览器 `fetch`**（第三方 `billion-context` 的做法，最简单、无跨包契约）：

Host 半侧（`billion-context/dist/agent/dsh-native.js:134`，压缩代码摘录）：

```js
const originRoute = {
  kind: "exact",
  path: "/bili/origin",
  handler: (_req, res) => {
    const body = JSON.stringify({ origin: currentOrigin() ?? null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  }
};
ctx.inject(["webServer"], sub => {
  const ws = sub.webServer;
  sub.effect(() => ws.register(originRoute), "bili: /bili/origin route");
});
// 另外可向 index 注入全局变量：
ctx.on?.("webserver/index-inject", table => {
  table.push({ kind: "global", name: "__BILI__", value: { origin } });
});
```

契约出处：`dsh-host-webserver/README.zh.md:61`「`register(route)` 添加具名的 `exact`／`prefix` HTTP route……返回的 disposer 都会移除注册。同一张表内的重复路径会抛错」；`:67`「index 启动输入分两层。`collectIndexInjections()` 收集一张全新的注入表——每次调用发一次 `webserver/index-inject` 事件，每个订阅方推入其当前行」。

浏览器半侧（`billion-context/dist/agent/dsh-native-client.js:122-135`）：`fetch('/bili/origin')` 轮询取 JSON，失败降级。

**通道 B：`remote` 命名空间 + `settings.describe` 镜像**（官方 UI 包的做法，有类型、有鉴权、有 schema）：
Host 用 `@deepseek-ai/dsh-settings` / `dsh-api-remotes` 注册命名空间；Client `ctx.inject(['remote','settings'], …)`，用 `ctx.configForms.get(entryId)` 拿到带 revision 的表单控制器，`ctx.configForms.whileServed([ns], cb)` 只在宿主真的服务该命名空间时才挂 UI（`dsh-client-ui-settings/README.zh.md:32-44`）。**这是"读写插件自己的配置"的标准通道**。

### 6.4 最小可运行样例：一个 `settings.section` 面板

文件集（3 个：`package.json`、`cordis.patch.yml`、`index.js`，加 1 个 `client.js`）：

`package.json`
```json
{
  "name": "@local/ctx-length-panel",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-settings"] }
  }
}
```

`cordis.patch.yml`
```yaml
- insert:
    - id: ctx-length-panel
      name: '@local/ctx-length-panel'
```

`index.js`（Host 半侧：可为空，也可放统计/配置服务）
```js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({ warnRatio: z.number().default(0.8) })

export function apply(ctx, config) {
  // 例：把配置发布给浏览器（或注册 webServer 路由 / ctx.on('agent/request') 等）
  ctx.logger('ctx-length').info('panel active, warnRatio=%d', config.warnRatio)
}
```

`client.js`（浏览器半侧，纯 JS，无 JSX，`require` 只能取基座模块）
```js
window.__ModuleLoader__.load({
  id: '@local/ctx-length-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'ctx-length'

    function Panel() {
      // 真实数据可用 fetch('/你的路由') 或注入的 props
      return h('div', { style: { padding: '20px 8px' } }, h('h3', null, '上下文长度'), '…')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: PANEL_ID, order: 100, label: () => '上下文长度' },
            Panel,
          ),
        )
      },
    }
  },
})
```

**（推断）** 这份最小集可以直接被 `install_bundle` 接受：它有 `dsh.bundle.patch`、patch 里 `insert` 的 `name` 就是包名本身（本地 link 安装可解析）、`dsh.client` + `exports["./client"]` 齐全、`client.js` 用 `__ModuleLoader__.load` 注册且 id 等于包名。**风险点**：`dsh.client.inject` 里写的 `@deepseek-ai/dsh-client-ui-settings` 必须是已安装的客户端包（官方 web 组合里有），否则组合阶段会以「缺失提供方」拒绝（`README.zh.md:51`）。

---

## 7. 落到「上下文长度管理插件」上：架构建议

### 7.1 Host 侧要用的扩展点（`practices.md` 给的强弱谱系）

| 强度 | 扩展点 | 适合做什么 |
|---|---|---|
| 弱 | `ctx.tools.restrict()` | 只能**移除**工具 → 压缩上下文时裁掉大工具 |
| 弱 | `ctx.tools.guard()` | 只能**拒绝**工具调用 |
| 中 | waterfall 监听器：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute`、`tools/execute`、`tools/post-execute` | 改写请求/结果（不拥有决策时必须 `return next()`） |
| 强 | `system-prompt/assemble` | 整体替换系统提示词 |
| 数据 | `ctx.tokenMeter`、`ctx.compaction`、`ctx.sessionProjections`、`ctx.llm` | 读 token 用量、触发/接管压缩、给面板算指标 |

**【已验证】** 服务名出处：`dsh-token-meter/README.zh.md`（`ctx.tokenMeter`、`ctx.sessionProjections`、`ctx.llm`）、`dsh-compaction/README.zh.md`（`ctx.compaction`、`ctx.tokenMeter`、`ctx.llm`）、`dsh-session-projection/README.zh.md`（`ctx.sessionProjections`，`ctx.inject`/`ctx.effect` 注册投影单元）。

**【已验证】** 性能/正确性注意（`practices.md`）：优先用 `ctx.sessionProjections` 投影单元（`apply(state, event)` 纯同步、返回同引用表示忽略；`stateVersion` 变化才作废 checkpoint）；等 `turn/end` / `assistant/message` / `tool/result` 等**持久事件**，不要轮询 `agent/status`；**不要在会话里 append 新 `type` 事件**（读方只接受带 `ignorable: true` 的未知事件，而 live `Session.append()` 设不了该标记）。

### 7.2 Client 侧要用的落点

**推荐 `settings.section`**（成本最低、无需侧栏图标、不占主区域）：
- 面板里显示：当前会话 token 用量 / 上下文窗口占比 / 压缩历史 / 阈值滑块。
- 写参数走 `ctx.configForms.get(entryId)`（官方标准通道，带 revision 防并发覆盖），或简单地 Host 半侧暴露一个 `webServer` 路由 + `fetch`（第三方做法，最省事但无类型/鉴权）。

**备选**：
- `plugins.item`（一张卡片挂在插件页，`ui-settings-shell` 同款）；
- `main` + `sidebar.panellist`（独立整页，像插件页那样，成本最高）。

### 7.3 包结构与安装路径

```
<workspace>/ctx-length/                 # 任意工作区目录（不要建在 $DSH_HOME 下）
  package.json           # dsh.bundle.patch + dsh.client
  cordis.patch.yml       # insert 一行
  index.js               # Host: Config + apply(ctx, config)，注册 ctx.effect / ctx.on
  client.js              # 浏览器: window.__ModuleLoader__.load({...})
  locale/{zh,en}.json    # 可选：面板标题/描述
```

安装：`plugin_manager` → `action: install_bundle`, `target: "<绝对目录>"`（`SKILL.md:8`）。
验证：`list_bundles` 看是否选中 + 是否 `error`；`list_plugins` 看该行 `fiberPhase`；`dsh --profile desktop --dump-config` 看组合结果；浏览器里设置页应出现新分区。

### 7.4 两个必须提前确认的坑（推断，建议实测）

1. **内置压缩插件藏在 `preset-standard` 里**。`billion-context` 的 patch 注释已经踩过这个坑：`- id: compaction-basic` 在 bundle 层定位不到 preset 内的那份实例。要改内置压缩行为，可能需要在 profile 层用 `- id: preset-standard` + 完整重述 `config` 来覆写整个 agent preset（`editing-cordis-compositions/SKILL.md` 明确：只能整体覆写、不能原地改）。
2. **`dsh.client.immediately` + `inject` 的加载顺序**：面板依赖 `ctx.slots` 与 `ctx.locale`，必须把提供它们的客户端包写进 `dsh.client.inject`（`slots` 由客户端基座提供；官方样例里普遍注入 `@deepseek-ai/dsh-client-ui-settings` 或 `dsh-client-locale`），否则可能 factory 先物化、`ctx.slots` 还不存在。

---

## 8. 事实 / 推断 分界清单

**已验证（有路径:行号出处）**
- Cordis 插件三形态、`Config`/`inject`/`provide` 归一化：`cordis/src/registry.ts:8-10,92-146,222-228,316-336`
- `ctx.effect` 立即执行 + 逆序清理 + `INACTIVE_EFFECT`：`cordis/src/fiber.ts:402-418`
- `Service` 注册/自动注销：`cordis/src/service.ts:11-59`
- patch DSL 全部规则：`dsh-agent-preset/skills/cordis-composition-reference/SKILL.md`
- 最小 bundle 清单与 Host 导出形式：`.../cordis-plugin-development/references/host-plugin.md:3,64,68`
- UI 插件声明与 slot 用法：`.../references/ui-plugin.md:3,9,11`
- `dsh.bundle.patch` 可为路径或有序列表：`dsh-package-manifest/README.zh.md:46`
- `dsh.client` 四键 + 校验代码：`dsh-client-modules/lib/index.js:62-76`
- `exports["./client"]` 必需：`dsh-client-modules/lib/index.js:171-181,732-738`
- 合并顺序（profile patch 在 bundle 层后、home 更高）：`dsh-app-boot/README.zh.md:61`
- 版本检查用 `engines.dsh` 或 `peerDependencies`：`dsh-app-boot/README.zh.md:52`
- 安装=pnpm add + 选入 bundles + 默认启用：`plugin-manager/README.zh.md:40,50,52`
- HMR 默认开、监视 linked 包目标：`dsh-hmr/README.zh.md:27,49`
- 客户端 bundle 必须 build：`dsh-client-modules/README.zh.md:55`
- `webServer.register` / `webserver/index-inject`：`dsh-host-webserver/README.zh.md:61,67`
- slot 清单与 `children` 声明：`ui-settings-models/lib/client.js:4484-4497`、`ui-settings-shell/lib/client.js:182-190`、`plugin-manager/lib/client.js:4413-4456`
- 第三方面板范本：`billion-context/dist/agent/dsh-native-client.js:245-252`、`dsh-native.js:134`
- profile 实况（bundles 混排、cordis.yml 为空、patch 按 id 覆写）：`C:\Users\40410\.dsh\profiles\desktop\{package.json,cordis.yml,cordis.patch.yml}`

**推断（无文档明说，需实测确认）**
- 同一层内 `insert` 行按顺序、同 id 后者覆写前者。
- 「bundle」是关系而非类型；一个包可同时是 bundle 与库。
- `dsh-package-manifest/README.zh.md:93` 的"不强制检查"已过期，以 app-boot 为准。
- 最小 4 文件样例能被 `install_bundle` 直接接受（尤其是本地 link 安装时 `name` 用包名本身即可解析）。
- 内置压缩实例位于 `preset-standard`，改它需整体覆写 preset。
- `dsh.client.inject` 里必须列出 `@deepseek-ai/dsh-client-ui-*` 提供方，否则组合期报缺失。

---

## 9. 关键文件路径索引（提取后位置）

| 用途 | 路径 |
|---|---|
| 插件开发技能总入口 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md` |
| Host 插件规范 | `.../skills/cordis-plugin-development/references/host-plugin.md` |
| UI 插件规范 | `.../skills/cordis-plugin-development/references/ui-plugin.md` |
| 扩展点实践（waterfall/投影） | `.../skills/cordis-plugin-development/references/practices.md` |
| patch DSL 权威 | `.../skills/cordis-composition-reference/SKILL.md` |
| agent preset 组合 | `.../skills/editing-cordis-compositions/SKILL.md` |
| 最小 UI bundle 模板 | `.../skills/cordis-plugin-development/templates/decoration/` |
| cordis 核心 | `.probe/asar/dsh/node_modules/@deepseek-ai/cordis/src/{registry,fiber,service,context,events}.ts` |
| Loader | `.probe/asar/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/{README.md,src/}` |
| 清单类型 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-package-manifest/README.zh.md` |
| 客户端模块系统 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-client-modules/{README.zh.md,lib/index.js}` |
| 启动/组合 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/README.zh.md` |
| 插件管理 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md` |
| HMR | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-hmr/README.zh.md` |
| HTTP 路由 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.zh.md` |
| 设置底座 / slot 契约 | `.probe/asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/README.zh.md` |
| 第三方完整范例 | `C:\Users\40410\.dsh\profiles\desktop\node_modules\billion-context\{package.json,dsh.bundle.patch.yml,dist/agent/dsh-native-client.js}` |
