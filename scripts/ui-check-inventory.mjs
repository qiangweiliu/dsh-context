/**
 * 验证「工具与提示词」卡：清单、会话开关、下一请求生效（applied）。
 * 用法：node scripts/ui-check-inventory.mjs <url>
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9338
const { send, evaluate, errors, close } = await openCdp({ port, profilePrefix: 'edge-inv-', captureConsole: true })
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(300)
  await evaluate(`(async () => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
    const b = Array.from(document.querySelectorAll('button')).find((x) => /发送消息/.test(norm(x.getAttribute('aria-label')) || ''))
    if (b) b.click()
  })()`)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/新建会话/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click(); await new Promise((r)=>setTimeout(r,1000)) })()`)
await sendMessage('hi')
await sleep(11000)
await sendMessage('second message so the prompt listener is installed before assembly')
await sleep(11000)

const panel = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 2500))
  const switches = Array.from(document.querySelectorAll('[data-ctx-switch]')).map((el) => el.getAttribute('data-ctx-switch'))
  const body = document.body.innerText || ''
  const firstTool = switches.find((key) => key.startsWith('tool:'))
  return { ok: true, switches, firstTool, body: body.slice(0, 2200) }
})()`)

const readInventory = () => evaluate("fetch('/api/ctx-mon-and-con/status/inventory', { headers: { accept: 'application/json' } }).then((r) => r.json()).catch(() => null)")
const before = await readInventory()

const toggle = panel.ok && panel.firstTool ? await evaluate(`(async () => {
  const key = ${JSON.stringify(panel.firstTool)}
  const el = document.querySelector('[data-ctx-switch="' + key + '"]')
  if (!el) return { ok: false, why: 'switch missing' }
  el.click()
  await new Promise((r) => setTimeout(r, 300))
  const confirm = document.querySelector('[data-ctx-confirm]')
  if (!confirm) return { ok: false, why: 'confirm missing' }
  confirm.click()
  await new Promise((r) => setTimeout(r, 1800))
  return { ok: true, body: (document.body.innerText || '').slice(0, 1200) }
})()`) : { ok: false, why: 'no tool switch' }

const afterToggle = await readInventory()
const firstPrompt = panel.switches.find((key) => key.startsWith('prompt:'))
const promptToggle = firstPrompt
  ? await evaluate(`(async () => {
      const key = ${JSON.stringify(firstPrompt)}
      const el = document.querySelector('[data-ctx-switch="' + key + '"]')
      if (!el) return { ok: false, why: 'switch missing' }
      el.click()
      await new Promise((r) => setTimeout(r, 300))
      const confirm = document.querySelector('[data-ctx-confirm]')
      if (!confirm) return { ok: false, why: 'confirm missing' }
      confirm.click()
      await new Promise((r) => setTimeout(r, 1500))
      return { ok: true, key }
    })()`)
  : { ok: false, why: 'no prompt switch' }
// 切回对话视图（ctx 面板占用了 main），并发一条新消息触发 pre-step 应用限制
await evaluate("location.reload()")
await sleep(6000)
await sendMessage('third message to apply the toggle')
await sleep(9000)
const afterApply = await readInventory()

console.log(JSON.stringify({ panel, toggle, promptToggle, before, afterToggle, afterApply, errors }, null, 2))
await close()
process.exit(0)
