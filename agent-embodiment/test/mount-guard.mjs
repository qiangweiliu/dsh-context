/**
 * 挂载幂等 + HMR 重挂回归。
 *
 * 背景：client.js 用 window.__agentEmbodimentMounted 做幂等。0.26.0 之前它只存 boolean，
 * 于是「页面已挂载过、client.js 又被热更新」时，新 bundle 的 apply() 会直接 return：
 * 新组件没注册、旧注册随旧模块被清理，结果就是侧栏还有「上下文」入口、主区域却空白。
 * 这里固定三条契约：
 *   1. 同一模块重复 apply → 跳过（不产生重复导航/dock）
 *   2. window 上标记的是旧版本（模拟 HMR 后的新 bundle）→ 必须重新注册
 *   3. 重新注册前，必须先调用上一个 bundle 留下的 disposer
 *
 * 运行：node test/mount-guard.mjs
 */
import { readFileSync } from 'node:fs'
import { loadClient } from './client-harness.mjs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${name}${condition || detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/** 测试桩的 slots.inject 只记录回调，需要显式触发才会真正 register。 */
const mountInjects = (loaded) => {
  for (const inject of loaded.slotInjects) {
    try {
      inject.callback()
    } catch {}
  }
}

// 1) 同一模块重复 apply：不应产生第二套注册
{
  const loaded = loadClient(source)
  mountInjects(loaded)
  const first = loaded.slotRegistrations.length
  const injectsBefore = loaded.slotInjects.length
  let secondReturn
  try {
    secondReturn = loaded.moduleExports.apply(loaded.ctx)
  } catch (error) {
    secondReturn = `threw: ${error?.message}`
  }
  check('首次挂载注册了槽位', first > 0, first)
  // 第二次 apply 应直接返回：既不新增 inject，也不新增注册。
  check(
    '同模块重复 apply 被跳过（无重复注册）',
    secondReturn === undefined && loaded.slotRegistrations.length === first && loaded.slotInjects.length === injectsBefore,
    { registrations: `${first}→${loaded.slotRegistrations.length}`, injects: `${injectsBefore}→${loaded.slotInjects.length}`, returned: secondReturn },
  )
}

// 2)+3) 模拟 HMR：window 上残留旧版本标记 + 旧 disposer
{
  let disposed = 0
  const staleScope = {
    __agentEmbodimentMounted: '0.0.0-stale',
    __agentEmbodimentSlotDisposers: [
      () => {
        disposed += 1
      },
    ],
  }
  const loaded = loadClient(source, { scope: staleScope })
  mountInjects(loaded)
  check('新版 bundle 检测到旧版本标记后仍会重新注册', loaded.slotRegistrations.length > 0, loaded.slotRegistrations.length)
  check('重新注册前先释放了旧 bundle 的槽位注册', disposed === 1, disposed)
  check('挂载标记被更新为当前版本', staleScope.__agentEmbodimentMounted === version, staleScope.__agentEmbodimentMounted)
  check('新 bundle 换上了新的 disposer 列表', Array.isArray(staleScope.__agentEmbodimentSlotDisposers) && staleScope.__agentEmbodimentSlotDisposers.length === loaded.slotRegistrations.length, { disposers: staleScope.__agentEmbodimentSlotDisposers?.length, registrations: loaded.slotRegistrations.length })
}

// 4) 同版本的重复挂载（静态 bundle + 激活）仍然幂等
{
  const sameScope = { __agentEmbodimentMounted: version, __agentEmbodimentSlotDisposers: [] }
  const loaded = loadClient(source, { scope: sameScope })
  mountInjects(loaded)
  check('同版本的第二次挂载被跳过', loaded.slotRegistrations.length === 0, loaded.slotRegistrations.length)
}

const failed = checks.filter((item) => !item.ok)
console.log(`\n[mount-guard] ${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('[mount-guard] 失败项：' + failed.map((item) => item.name).join(' | '))
  process.exitCode = 1
}
