/**
 * agent-embodiment — 浏览器半侧
 *
 * 三个挂载点共用一套视觉：
 *   1. conversation.composer.dock —— 输入框下方，与 DSH 内置 ContextMeter 同一排版
 *   2. main (key = 'embody')         —— 左侧导航整页
 *   3. settings.section           —— 设置 → 智能体具身
 *
 * 视觉参考：DSH 自带 ContextMeter 的 trigger/panel 尺寸与颜色 token；
 * 面板卡片布局参考 dsh-context 插件（lc-card / lc-card-title / lc-chip 的信息密度），
 * 但全部用内联样式 + --dsw-alias-* token 实现，不引入 CSS 文件、不依赖 Tailwind。
 */
window.__ModuleLoader__.load({
  id: 'agent-embodiment',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    const NS = 'agentEmbodiment'
    /** 与 package.json 版本保持一致；宿主版本不同时提示刷新页面而不是重启 DSH。 */
    const CLIENT_VERSION = '0.29.0'
    /**
     * API 路径必须相对页面 base 解析，而不是写死根路径：
     * 反向代理部署在 /app/dsh/ 这类前缀下时，根路径 /api/... 会打到网关根并 404。
     * 没有 document 的测试/SSR 环境退回根路径。
     */
    const STATUS_PATH = (() => {
      try {
        if (typeof document === 'undefined' || typeof document.baseURI !== 'string') return '/api/agent-embodiment/status'
        const base = new URL(document.baseURI)
        if (!base.pathname.endsWith('/')) {
          const last = base.pathname.slice(base.pathname.lastIndexOf('/') + 1)
          if (last.includes('.')) base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)
          else base.pathname += '/'
        }
        return new URL('api/agent-embodiment/status', base).pathname
      } catch {
        return '/api/agent-embodiment/status'
      }
    })()
    const PANEL_ID = 'embody'
    const CONFIG_NAMESPACE = 'agent-embodiment'

