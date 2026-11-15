#!/usr/bin/env node
/**
 * 模板评估的隔离环境（只有一套，且**不做 compaction tuning**）。
 *
 * 为什么单独一个脚本，而不是复用 setup-conditions.mjs：
 *
 *   1. **只建一套 home 就够。** `--condition scaffold` 与 `--condition base` 的差别只有
 *      一个环境变量 `DSH_AGENTS_HOME`（run.mjs 里设置），DSH_HOME 可以完全相同。
 *      原来的「base-home + plugin-home」是给「装/不装插件」那类实验用的，模板评估不需要。
 *   2. **不缩上下文窗口。** setup-conditions 会把 contextWindow 调到 40000 并加
 *      compaction-basic，目的是让压缩在几十轮内被观察到。模板题目不涉及压缩，套用这套
 *      tuning 等于让待测对象在一个为别的实验改过的环境里跑，引入无关变量。
 *   3. **不复制凭据。** provider 配置里是 `apiKeyEnv: OPENCODE_GO_API_KEY`，运行时
 *      export 即可；把 `.credentials.yaml` 复制进 home 会在磁盘上留明文密钥副本。
 *
 * 用法：
 *   export OPENCODE_GO_API_KEY=...        # 必须
 *   node eval/deep/template-conditions.mjs # 打印 home 路径
 *   node eval/deep/run.mjs --questions eval/deep/questions-templates.jsonl \
 *     --condition base --ds-home <home> --ids ... --out ...
 *   node eval/deep/run.mjs --questions eval/deep/questions-templates.jsonl \
 *     --condition scaffold --ds-home <home> --scaffold-home <scaffold> --ids ... --out ...
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const FROM = resolve(flag('from', join(homedir(), '.dsh', 'profiles', 'headless')))
const HOME_DIR = resolve(flag('home', join(homedir(), '.cache', 'embody-eval', 'tpl-home')))

const profile = join(HOME_DIR, 'profiles', 'headless')
mkdirSync(profile, { recursive: true })
copyFileSync(join(FROM, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'))
copyFileSync(join(FROM, 'cordis.yml'), join(profile, 'cordis.yml'))
rmSync(join(profile, 'node_modules'), { recursive: true, force: true })
if (existsSync(join(FROM, 'node_modules'))) symlinkSync(join(FROM, 'node_modules'), join(profile, 'node_modules'))
writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-headless',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
}, null, 2)}\n`)
mkdirSync(join(HOME_DIR, 'sessions'), { recursive: true })

// 明确的「不留凭据副本」检查：万一有人手工拷过，这里报出来而不是默默用着。
if (existsSync(join(HOME_DIR, '.credentials.yaml'))) {
  console.warn(`[tpl-setup] 警告：${join(HOME_DIR, '.credentials.yaml')} 存在（明文凭据副本）；请删除并改用环境变量`)
}

const hasKey = Boolean(process.env.OPENCODE_GO_API_KEY)
console.log(JSON.stringify({
  home: HOME_DIR,
  tuned: false,
  credentialsCopied: false,
  apiKeyInEnv: hasKey,
  note: hasKey ? undefined : '缺 OPENCODE_GO_API_KEY：先 export，否则运行会以 MISSING_CREDENTIAL 失败',
}, null, 2))