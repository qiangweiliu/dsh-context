/**
 * routes-scaffold.js 的直接单测（不需要 Cordis、不需要 app.asar）。
 *
 * 这是 0.36.0 抽出 scaffold 路由的直接收益：以前这三个 handler 藏在
 * index.js 的 apply() 闭包里，只能通过启动完整 Cordis 上下文 + MockWebServer
 * 间接测；现在可以喂假 request/response 直接验证边界。
 *
 * 运行：node test/routes-scaffold.mjs
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createScaffoldRoutes, isProtectedScaffoldPath } from '../routes-scaffold.js'

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

const statusFor = (code) => ({ json: 200, csv: 200 }[code] ?? code)

/** 与 index.js 里 jsonSender 同契约的最小实现。 */
const jsonSender = (response) => (status, body) => {
  response.statusCode = status
  response.setHeader('content-type', typeof body === 'string' ? 'text/plain' : 'application/json')
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** 与 index.js 里 requireMethod 同契约。 */
const requireMethod = (request, response, method) => {
  if (request.method === method) return true
  response.setHeader('allow', method)
  jsonSender(response)(405, { ok: false, error: 'method not allowed' })
  return false
}

/** 与 index.js 里 readJson 同契约：从流里读 JSON，超限或解析失败回 400。 */
const readJson = (request, response, onBody, limit = 256 * 1024, message = 'invalid json') => {
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > limit) return
    chunks.push(chunk)
  })
  request.on('end', () => {
    if (size > limit) return jsonSender(response)(413, { ok: false, error: 'payload too large' })
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return jsonSender(response)(400, { ok: false, error: message })
    }
    onBody(parsed, size)
  })
}

const routes = createScaffoldRoutes({ home: resolve(homedir()), dshHome: join(resolve(homedir()), '.dsh'), jsonSender, requireMethod, readJson })

const makeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
  end(body) { this.body = body ?? ''; this.done = true },
})

const call = (handler, method, payload) => new Promise((resolvePromise) => {
  const request = new EventEmitter()
  request.method = method
  const response = makeResponse()
  response.onFinish = () => resolvePromise(response)
  const originalEnd = response.end.bind(response)
  response.end = (body) => { originalEnd(body); resolvePromise(response) }
  handler(request, response)
  if (method === 'POST') {
    setImmediate(() => {
      request.emit('data', Buffer.from(payload === undefined ? '{}' : JSON.stringify(payload)))
      request.emit('end')
    })
  }
})

const json = (response) => {
  try { return JSON.parse(response.body || '{}') } catch { return {} }
}

// ── 模板列表 ──
const list = await call(routes.scaffoldTemplateList, 'GET')
const listBody = json(list)
check('GET templates 返回 200', list.statusCode === 200, list.statusCode)
check('模板数量为 6', Array.isArray(listBody.templates) && listBody.templates.length === 6, listBody.templates?.length)
check('模板带 experimental 标记', listBody.templates.some((item) => item.experimental === true) && listBody.templates.some((item) => item.experimental === false), listBody.templates?.map((item) => `${item.id}:${item.experimental}`))
const listPost = await call(routes.scaffoldTemplateList, 'POST', {})
check('templates 拒绝 POST（405）', listPost.statusCode === 405, listPost.statusCode)

// ── 预览 ──
const preview = await call(routes.scaffoldPreviewHandler, 'POST', { template: 'repo-coder', slug: 'unit-demo', name: 'Unit Demo' })
const previewBody = json(preview)
check('preview 合法 spec 返回 200', preview.statusCode === 200 && Array.isArray(previewBody.files), preview.statusCode)
check('preview 含 bundleDir 与安装命令', typeof previewBody.bundleDir === 'string' && String(previewBody.installCommand).includes('dsh plugin'), previewBody.bundleDir)
const badPreview = await call(routes.scaffoldPreviewHandler, 'POST', { template: 'no-such-template', slug: 'x', name: 'X' })
check('preview 未知模板返回 400', badPreview.statusCode === 400, badPreview.statusCode)

// ── 生成：路径守卫 ──
const relative = await call(routes.scaffoldGenerateHandler, 'POST', { template: 'repo-coder', slug: 'x', name: 'X', targetDir: 'relative/path' })
check('生成拒绝相对路径（400）', relative.statusCode === 400, json(relative).error)
const atHome = await call(routes.scaffoldGenerateHandler, 'POST', { template: 'repo-coder', slug: 'x', name: 'X', targetDir: resolve(homedir()) })
check('生成拒绝 home 目录（400）', atHome.statusCode === 400, json(atHome).error)
const atDshHome = await call(routes.scaffoldGenerateHandler, 'POST', { template: 'repo-coder', slug: 'x', name: 'X', targetDir: join(resolve(homedir()), '.dsh') })
check('生成拒绝 DSH_HOME（400）', atDshHome.statusCode === 400, json(atDshHome).error)
check('isProtectedScaffoldPath 对临时目录放行', isProtectedScaffoldPath(resolve(tmpdir(), 'unit-scaffold-ok'), { home: resolve(homedir()), dshHome: join(resolve(homedir()), '.dsh') }) === false)

// ── 8.3 短名：能展开就放行，展不开才拒绝 ──
// 背景（0.50.4 的 Windows CI 实测）：runner 的 tmpdir 是
// `C:\Users\RUNNER~1\AppData\Local\Temp`，旧实现一见 `~N` 就判受保护，
// 于是「生成到临时目录」整条路都 400。长用户名下的真实用户同样会踩。
{
  const home = 'C:\\Users\\runneradmin'
  const roots = { home, dshHome: join(home, '.dsh') }
  const shortTmp = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\unit-scaffold-ok'

  // 展开成功 → 落到长名临时目录，应当放行
  const expanded = isProtectedScaffoldPath(shortTmp, roots, {
    expand: (input) => String(input).replace(/RUNNER~1/i, 'runneradmin'),
  })
  check('8.3 短名可展开时放行（不再一律拒绝）', expanded === false, expanded)

  // 展开失败 → 仍按受保护处理（无法确定真实目录就不猜）
  const unresolved = isProtectedScaffoldPath(shortTmp, roots, { expand: () => undefined })
  check('8.3 短名展不开时仍拒绝', unresolved === true, unresolved)

  // 展开后落在系统目录 → 仍然拒绝，不能靠短名绕过
  const intoWindows = isProtectedScaffoldPath('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\x', { home, dshHome: join(home, '.dsh') }, {
    expand: () => 'C:\\Windows\\System32\\drivers',
  })
  check('短名展开到系统目录仍拒绝', intoWindows === true, intoWindows)

  // 展开后落在 home 下 → 仍然拒绝
  const intoHome = isProtectedScaffoldPath(shortTmp, roots, { expand: () => join(home, 'Documents', 'x') })
  check('短名展开到 home 下仍拒绝', intoHome === true, intoHome)
}

// ── 生成：真实落盘 + 覆盖语义 + AGENTS 合并 ──
const workspace = mkdtempSync(join(tmpdir(), 'ctx-scaffold-'))
const gen = await call(routes.scaffoldGenerateHandler, 'POST', {
  template: 'repo-coder', slug: 'unit-run', name: 'Unit Run', targetDir: workspace, writeAgents: true,
})
const genBody = json(gen)
check('生成返回 202', gen.statusCode === 202, gen.statusCode)
check('生成真的写了文件', genBody.files?.length > 0 && existsSync(join(workspace, genBody.files[0])), genBody.files?.[0])
check('生成返回 agentsPath', typeof genBody.agentsPath === 'string' && existsSync(genBody.agentsPath), genBody.agentsPath)
const agentsText = genBody.agentsPath ? readFileSync(genBody.agentsPath, 'utf8') : ''
check('AGENTS.md 带幂等 marker', /<!--\s*agent-scaffold:[\w-]+:start\s*-->/u.test(agentsText), agentsText.slice(0, 60))

const again = await call(routes.scaffoldGenerateHandler, 'POST', { template: 'repo-coder', slug: 'unit-run', name: 'Unit Run', targetDir: workspace })
check('重复生成无 overwrite 返回 409', again.statusCode === 409 && Array.isArray(json(again).existing), again.statusCode)
const overwrite = await call(routes.scaffoldGenerateHandler, 'POST', { template: 'repo-coder', slug: 'unit-run', name: 'Unit Run', targetDir: workspace, overwrite: true })
check('overwrite:true 覆盖成功（202）', overwrite.statusCode === 202, overwrite.statusCode)

rmSync(workspace, { recursive: true, force: true })

const failed = checks.filter((item) => !item.ok)
console.log(`\n[routes-scaffold] ${checks.length - failed.length}/${checks.length} 项通过`)
for (const item of failed) console.error(`  FAIL - ${item.name} (${JSON.stringify(item.detail)})`)
if (failed.length > 0) process.exitCode = 1

void statusFor
