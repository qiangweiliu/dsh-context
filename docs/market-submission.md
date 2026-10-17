# 为什么在插件市场搜不到，以及怎么让它出现

结论先行：**搜不到是预期内的** —— 它不是「坏了」，而是这个仓库还没被收录进市场的精选目录。
下面是对照市场源码与收录仓库 CI 逐条核实的排查记录，以及剩下的三步操作。

## 1. 市场的数据来源

本机 profile 装的 `dshmarket`（`v1.66.12`）不维护自己的插件库：每次打开市场都会实时拉取

```
https://awesome-dsh-plugin.com/plugins.json
```

它是 `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin` 构建出来的目录快照。
本地已装的插件**不会**被市场列出：市场只把「本地已安装」当作目录条目的一个状态去匹配
（`dshmarket/src/catalog-local-match.ts`），没有目录条目就没有这一行。
已装插件能查到的地方是 DSH 自带的**插件管理**，不是市场。

## 2. 排查结果

| 检查项 | 结果 |
| --- | --- |
| 目录里有没有 `qiangweiliu` | 没有。`plugins.json` 共 5065 条，owner 过滤为空 |
| 有没有同名/同包名条目 | 没有 `dsh-context-guard`；但有相近的 `context-guardian`（包名 `dsh-context-guardian`，session 类） |
| 是否发布过 npm | 没有，所以也没有「npm → 仓库」的自动关联 |
| 是否有 GitHub Release tarball | 没有 |
| 从源码能不能装 | **能，已实测**（见 §3） |

## 3. 已实测通过的部分

在隔离的 `DSH_HOME` 里跑真实的源码安装（等价于市场会展示的安装命令）：

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-mkt-test"
dsh plugin --profile mkt-add add "github:qiangweiliu/dsh-context#path:/plugin-skeleton"
```

结果：pnpm 成功解析并安装 `dsh-context-guard@0.1.0`，包内 `index.js`、`client.js`、
`dsh.bundle.patch.yml`、`locale/*` 齐全；随后 `dsh --profile mkt-add --dump-config`
输出里出现

```
# == dsh-context-guard
- id: context-guard
  name: dsh-context-guard
```

说明 bundle 补丁在安装后的 profile 里确实生效 —— 也就是「可安装」这一关已经过了。

> 注意：安装时 pnpm 会对 `https://github.com/qiangweiliu/dsh-context` 做一个 HEAD 探测，
> 本机会先超时重试 3 次（约 1 分 40 秒）再改走 git 成功。这是网络侧现象，不是打包问题。

## 4. 还差什么

### 4.1 收录申请 PR（唯一能让它出现在市场的方式）

给 `awesome-dsh-plugin` 提一个 PR，**只加一个文件**
`data/plugins/qiangweiliu__dsh-context--plugin-skeleton.yml`，内容已备好：
`submission/qiangweiliu__dsh-context--plugin-skeleton.yml`，直接复制过去即可。

要点：

- 条目必须指向**子目录**而不是仓库根：根 `package.json` 没有 `dsh.bundle`，
  根条目会被 CI 判为「装了也没东西」，并提示改成子目录形式。
- 文件名与 `name` 字段要带上子目录：`name: qiangweiliu/dsh-context#plugin-skeleton`。
- `url` 必须与仓库地址逐字一致（`/tree/main/plugin-skeleton`）。
- 一个 PR 最多 3 条，这里只交 1 条。

### 4.2 仓库满足两个硬性条件

| 条件 | 现状 | 怎么办 |
| --- | --- | --- |
| 仓库创建满 **1 天** | 2026-10-17 15:45（+08:00）创建，**不满足** | 等 24 小时后再提 PR；CI 会自动校验这一项 |
| 仓库带 `dsh-plugin` topic | 目前 topics 为空，**不满足** | GitHub 仓库页 → About 齿轮 → Topics 填 `dsh-plugin` |

`dsh-plugin` topic 也可以通过 API 设置（需要 token）：

```powershell
$body = @{ names = @('dsh-plugin') } | ConvertTo-Json
Invoke-RestMethod -Method Put -Headers @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json' } `
  -Uri https://api.github.com/repos/qiangweiliu/dsh-context/topics -Body $body -ContentType 'application/json'
```

### 4.3 可选，但强烈建议

- **改包名**：`dsh-context-guard` 与已收录的 `context-guardian`（`dsh-context-guardian`）只差两个字母，
  评审和用户都容易混。建议改成 `dsh-context-budget` 这类无歧义的名字（改 `package.json` 的 `name`
  与 `dsh.bundle.patch.yml` 里的 `name` 两处）。
- **加 LICENSE 文件**：`package.json` 写了 `license: MIT` 但没有 LICENSE 正文。
- **发布 npm**：收录不看 npm，但有了 npm 包市场会显示下载量、安装也免掉源码构建步骤；
  发布时 `repository` 字段必须指回本仓库，否则不会被关联。
- **截图**：在 `plugin-skeleton/` 下放 `screenshots.json` 列 1–8 张图，市场详情页会展示。

## 5. 一个要提前想清楚的问题：会不会被判「已被覆盖」

目录里已经有一大批同类插件，session 类里就包括 `billion-context`、`dsh-context-compressor`、
`dsh-smart-compact`、`dsh-compaction-policy`、`Missher-DSH-Context-Manager`、
`context-guardian`、`dsh-ballast`（上下文占用归属面板）等。收录规则第 4 条是
「已被现有条目覆盖的，先来者保留位置」。

当前骨架的定位是**参考实现 + 只读用量面板**（`/ctx` 显示用量/预算/阈值，只读状态接口，
不改历史），这个定位本身是可以如实描述的，描述里已经写明「不压缩、不改写历史」，
不会因夸大被打回。但如果希望一次就过、且真的有人用，建议先补一个别人没有的点再提交，
例如：按 provider/model 自动取窗口预算、把 `compaction-basic` 的 `auto` 与阈值做成设置面板、
在超过阈值时主动提示并给出一键 `/compact`。
