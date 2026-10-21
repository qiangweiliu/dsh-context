/**
 * Headless UI probe for the DSH web app (Windows Edge + CDP).
 *
 * 用途：不靠人眼，直接打开 WSL 里 `dsh --profile web` 的页面，展开设置，
 * 读导航项、抓控制台错误——用来确认 ctx-mon-and-con 的 settings.section 到底有没有注册。
 *
 * 依赖：Windows 自带 Edge；Node 22+ 的全局 WebSocket/fetch。
 * 用法：node scripts/ui-probe.mjs "http://127.0.0.1:3080/?token=..." [要查找的文本...]
 */
import { openCdp, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
const rest = process.argv.slice(3)
const sectionArg = rest.find((a) => a.startsWith('--section='))
const sectionText = sectionArg ? sectionArg.slice('--section='.length) : ''
const runArg = rest.find((a) => a.startsWith('--run='))
const runText = runArg ? runArg.slice('--run='.length) : ''
const needles = rest.filter((a) => !a.startsWith('--'))
if (!baseUrl) {
  console.error('usage: node ui-probe.mjs <url> [needle...]')
  process.exit(2)
}
const port = 9333
const { send, evaluate, consoleLines, exceptions, close } = await openCdp({ port, profilePrefix: 'edge-dsh-', captureAllConsole: true })

await send('Runtime.enable')
await send('Page.enable')
await send('Log.enable')
await send('Page.navigate', { url: baseUrl })

// 等页面 hydrate（__DSH_BOOT__ 注入 + React 挂载）
let ready = false
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  try {
    ready = await evaluate("document.readyState === 'complete' && !!document.body && document.body.children.length > 0")
  } catch {}
  if (ready) break
}
await sleep(2500)

// 首次启动可能挡着 Preview Notice 弹窗；先点掉，否则 composer 拿不到焦点。
await evaluate(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /^(Continue|继续)$/.test((b.textContent || '').trim()))
  if (!btn) return false
  btn.click()
  return true
})()`)
await sleep(1200)

// 可选：先在输入框里执行一条斜杠命令（例如 /ctx），验证命令真的注册并可执行。
let runResult = null
if (runText) {
  // 工作区/会话初始化可能比首屏慢，轮询等待 composer 出现，而不是只查一次。
  let focused = false
  for (let i = 0; i < 30 && !focused; i += 1) {
    focused = await evaluate(`(async () => {
      const el = document.querySelector('textarea, [contenteditable="true"]')
      if (!el) return false
      el.focus()
      return document.activeElement === el
    })()`)
    if (!focused) await sleep(500)
  }
  if (focused) {
    await send('Input.insertText', { text: runText })
    await sleep(900)
    // 斜杠命令通常先弹出候选面板：优先点候选里的第一条（文本含命令名）。
    const picked = await evaluate(`(async () => {
      const name = ${JSON.stringify(runText.replace(/^\//, ''))}
      const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, [role="button"]'))
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
      const hit = items.find((el) => {
        const t = norm(el.textContent)
        if (!t || t.length > 80) return false
        if (!t.includes(name)) return false
        const editable = el.closest('[contenteditable="true"], textarea')
        return !editable
      })
      if (!hit) return null
      hit.click()
      return norm(hit.textContent).slice(0, 80)
    })()`)
    if (!picked) {
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
    } else {
      // 选中候选后命令名已落进输入框，再回车才会真正执行。
      await sleep(800)
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
    }
    await sleep(5000)
    // 若回车没触发，退回点「发送消息」按钮
    let after = await evaluate('document.body.innerText.slice(0, 2000)')
    if (!after.includes('上下文长度：')) {
      const sent = await evaluate(`(async () => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => {
          const s = [b.getAttribute('aria-label'), b.getAttribute('title'), (b.textContent || '')].filter(Boolean).join(' ')
          return /发送消息|send message|send/i.test(s) && !b.disabled
        })
        if (!btn) return false
        btn.click()
        return true
      })()`)
      if (sent) await sleep(5000)
      after = await evaluate('document.body.innerText.slice(0, 2000)')
    }
    runResult = {
      sent: runText,
      picked,
      bodyAfter: after,
    }
  } else {
    runResult = { sent: runText, error: 'composer not found' }
  }
}

const probe = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const all = () => Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a, [aria-label]'))
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    aria: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    text: norm(el.textContent).slice(0, 40),
  })
  const before = all().map(describe).filter((d) => d.aria || d.text || d.title).slice(0, 60)

  // 找设置入口：aria-label/title 里带 settings/设置/preferences 的，或齿轮图标按钮
  const candidates = all().filter((el) => {
    const s = [el.getAttribute('aria-label'), el.getAttribute('title'), norm(el.textContent)].filter(Boolean).join(' ')
    return /settings|设置|preferences|偏好/i.test(s)
  })
  let clicked = null
  if (candidates.length > 0) {
    candidates[0].click()
    clicked = describe(candidates[0])
  } else {
    // 退而求其次：找点击后会出现设置面板的入口——直接点侧栏最底部的按钮
    const buttons = Array.from(document.querySelectorAll('button'))
    const last = buttons[buttons.length - 1]
    if (last) { last.click(); clicked = describe(last) }
  }
  await new Promise((r) => setTimeout(r, 1200))

  const after = all().map(describe).filter((d) => d.aria || d.text || d.title).slice(0, 120)
  const navTexts = after.map((d) => [d.aria, d.title, d.text].filter(Boolean).join(' | ')).filter(Boolean)
  const bodyText = document.body.innerText || ''
  let sectionBody = ''
  let sectionClicked = null
  if (${JSON.stringify(sectionText)}) {
    const want = ${JSON.stringify(sectionText)}
    const items = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a'))
    const hit = items.find((el) => norm(el.textContent) === want) ?? items.find((el) => norm(el.textContent).includes(want))
    if (hit) { hit.click(); sectionClicked = describe(hit); await new Promise((r) => setTimeout(r, 1200)) }
    sectionBody = (document.body.innerText || '').slice(0, 2500)
  }
  return { clicked, before, after, navTexts, bodySample: bodyText.slice(0, 1500), hasSettingsDialog: !!document.querySelector('[role="dialog"]'), sectionClicked, sectionBody }
})()`)

const needlesHit = Object.fromEntries(needles.map((n) => [n, probe.bodySample.includes(n) || probe.navTexts.some((t) => t.includes(n))]))
const consoleErrors = [...consoleLines, ...exceptions].filter((line) => /error|exception|failed|cannot|undefined is not|slot/i.test(line))

console.log(JSON.stringify({
  ready,
  runResult,
  clicked: probe.clicked,
  hasSettingsDialog: probe.hasSettingsDialog,
  sectionClicked: probe.sectionClicked,
  sectionBody: probe.sectionBody,
  needlesHit,
  navTexts: probe.navTexts,
  bodySample: probe.bodySample,
  consoleErrors,
  consoleCount: consoleLines.length,
  exceptionCount: exceptions.length,
}, null, 2))

await close()
process.exit(0)
