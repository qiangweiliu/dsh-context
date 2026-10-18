/**
 * 验证工具/提示词两级折叠 + 展开内容。
 * 用法：node scripts/ui-check-inventory-detail.mjs <url>
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9340
const { send, evaluate, errors, close } = await openCdp({ port, profilePrefix: 'edge-det-', captureConsole: true })
const sendMessage = async (text) => {
  await evaluate(`(async () => { const c = document.querySelector('textarea, [contenteditable="true"]'); if (c) c.focus() })()`)
  await send('Input.insertText', { text })
  await sleep(300)
  await evaluate(`(async () => { const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim(); const b=Array.from(document.querySelectorAll('button')).find((x)=>/发送消息/.test(norm(x.getAttribute('aria-label'))||'')); if (b) b.click() })()`)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: baseUrl })
for (let i = 0; i < 60; i += 1) { await sleep(500); if (await evaluate("document.readyState === 'complete' && document.body && document.body.children.length > 0")) break }
await sleep(2500)
await evaluate(`(async () => { const b=Array.from(document.querySelectorAll('button')).find((x)=>/新建会话/.test(x.getAttribute('aria-label')||'')); if (b) b.click(); await new Promise((r)=>setTimeout(r,1000)) })()`)
await sendMessage('hi')
await sleep(11000)
await sendMessage('second message so the prompt listener is installed')
await sleep(11000)

const result = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 2500))
  const sections = Array.from(document.querySelectorAll('[data-ctx-section]')).map((el) => el.getAttribute('data-ctx-section'))
  const collapsedExpands = document.querySelectorAll('[data-ctx-expand]').length
  document.querySelector('[data-ctx-section="tools"]').click()
  await new Promise((r) => setTimeout(r, 400))
  const expands = Array.from(document.querySelectorAll('[data-ctx-expand]')).map((el) => el.getAttribute('data-ctx-expand'))
  const collapsedCount = document.querySelectorAll('[data-ctx-detail]').length
  // 展开第一个工具
  const firstTool = expands.find((key) => key.startsWith('tool:'))
  let toolDetail = null
  let toolSchema = null
  if (firstTool) {
    document.querySelector('[data-ctx-expand="' + firstTool + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    toolDetail = (document.querySelector('[data-ctx-detail="' + firstTool + '"]') || {}).textContent || null
    toolSchema = (document.querySelector('[data-ctx-schema="' + firstTool + '"]') || {}).textContent || null
  }
  // 展开「提示词 section」大分区，再收起，验证折叠
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterExpand = Boolean(document.querySelector('[data-ctx-expand^="prompt:"]'))
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterCollapse = Boolean(document.querySelector('[data-ctx-expand^="prompt:"]'))
  document.querySelector('[data-ctx-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  // 展开第一个提示词
  const promptKey = Array.from(document.querySelectorAll('[data-ctx-expand]')).map((el) => el.getAttribute('data-ctx-expand')).find((key) => key.startsWith('prompt:'))
  let promptText = null
  let promptCopy = false
  if (promptKey) {
    document.querySelector('[data-ctx-expand="' + promptKey + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    promptText = (document.querySelector('[data-ctx-detail="' + promptKey + '"]') || {}).textContent || null
    promptCopy = Boolean(document.querySelector('[data-ctx-detail="' + promptKey + '"]') && document.querySelectorAll('button').length > 0)
  }
  return {
    ok: true,
    sections,
    collapsedExpands,
    expandsCount: expands.length,
    collapsedCount,
    firstTool,
    toolDetailLength: toolDetail ? toolDetail.length : 0,
    toolSchemaLength: toolSchema ? toolSchema.length : 0,
    toolSchemaHead: toolSchema ? toolSchema.slice(0, 120) : null,
    promptsVisibleAfterExpand,
    promptsVisibleAfterCollapse,
    promptKey,
    promptTextLength: promptText ? promptText.length : 0,
    promptTextHead: promptText ? promptText.slice(0, 120) : null,
    promptCopy,
  }
})()`)

console.log(JSON.stringify({ result, errors }, null, 2))
await close()
process.exit(0)
