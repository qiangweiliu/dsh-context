/**
 * 验证工具/提示词两级折叠 + 展开内容。
 * 用法：node scripts/ui-check-inventory-detail.mjs <url>
 */
import { openPage, sendMessage as sendText, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const port = 9340
const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-det-', captureConsole: true })
const sendMessage = (text) => sendText({ send, evaluate }, text)

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
  const sections = Array.from(document.querySelectorAll('[data-embodiment-section]')).map((el) => el.getAttribute('data-embodiment-section'))
  const collapsedExpands = document.querySelectorAll('[data-embodiment-expand]').length
  document.querySelector('[data-embodiment-section="tools"]').click()
  await new Promise((r) => setTimeout(r, 400))
  const expands = Array.from(document.querySelectorAll('[data-embodiment-expand]')).map((el) => el.getAttribute('data-embodiment-expand'))
  const collapsedCount = document.querySelectorAll('[data-embodiment-detail]').length
  // 展开第一个工具
  const firstTool = expands.find((key) => key.startsWith('tool:'))
  let toolDetail = null
  let toolSchema = null
  if (firstTool) {
    document.querySelector('[data-embodiment-expand="' + firstTool + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    toolDetail = (document.querySelector('[data-embodiment-detail="' + firstTool + '"]') || {}).textContent || null
    toolSchema = (document.querySelector('[data-embodiment-schema="' + firstTool + '"]') || {}).textContent || null
  }
  // 展开「提示词 section」大分区，再收起，验证折叠
  document.querySelector('[data-embodiment-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterExpand = Boolean(document.querySelector('[data-embodiment-expand^="prompt:"]'))
  document.querySelector('[data-embodiment-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const promptsVisibleAfterCollapse = Boolean(document.querySelector('[data-embodiment-expand^="prompt:"]'))
  document.querySelector('[data-embodiment-section="prompts"]').click()
  await new Promise((r) => setTimeout(r, 300))
  // 展开第一个提示词
  const promptKey = Array.from(document.querySelectorAll('[data-embodiment-expand]')).map((el) => el.getAttribute('data-embodiment-expand')).find((key) => key.startsWith('prompt:'))
  let promptText = null
  let promptCopy = false
  if (promptKey) {
    document.querySelector('[data-embodiment-expand="' + promptKey + '"]').click()
    await new Promise((r) => setTimeout(r, 400))
    promptText = (document.querySelector('[data-embodiment-detail="' + promptKey + '"]') || {}).textContent || null
    promptCopy = Boolean(document.querySelector('[data-embodiment-detail="' + promptKey + '"]') && document.querySelectorAll('button').length > 0)
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
