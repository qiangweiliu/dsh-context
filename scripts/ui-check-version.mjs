/**
 * 验证 ctx 页面标题旁显示插件版本号（data-embodiment-version）。
 * 用法：node scripts/ui-check-version.mjs "<baseUrl 含 token>"
 */
import { openPage, sleep } from './lib/cdp.mjs'

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/ui-check-version.mjs <url>')
  process.exit(2)
}
const port = 9347

const { send, evaluate, errors, close } = await openPage(baseUrl, { port, profilePrefix: 'edge-version-' })


const result = await evaluate(`(async () => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const btn = Array.from(document.querySelectorAll('button')).find((b) => norm(b.getAttribute('aria-label')) === 'ctx' || norm(b.textContent) === 'ctx')
  if (!btn) return { ok: false, why: 'sidebar ctx not found' }
  btn.click()
  await new Promise((r) => setTimeout(r, 1500))
  const chip = document.querySelector('[data-embodiment-version]')
  const panel = document.querySelector('[data-embodiment-panel]')
  const titleEl = panel ? panel.querySelector('h2') : null
  return {
    ok: Boolean(chip),
    version: chip ? norm(chip.textContent) : null,
    title: titleEl ? norm(titleEl.textContent) : null,
    chipTitleAttr: chip ? chip.getAttribute('title') : null,
    panelPresent: Boolean(panel),
    body: (document.body.innerText || '').slice(0, 400),
  }
})()`)

console.log(JSON.stringify({ ...result, errors }, null, 2))
await close()
process.exit(result.ok ? 0 : 1)
