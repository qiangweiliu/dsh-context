// 用插件内置的 PROMPT_TEMPLATES 生成评测 patch，保证测的就是将要发出去的文本。
//   node eval/make-template-patch.mjs
import { writeFileSync } from 'node:fs'
import { PROMPT_TEMPLATES } from '../agent-embodiment/index.js'

const text = PROMPT_TEMPLATES[0].text
const indent = (body) => body.split('\n').map((line) => (line ? `      ${line}` : '')).join('\n')
const yaml = `# T 臂：默认 persona + 插件内置方法论模板（作为 system 提示词追加），文本取自 agent-embodiment/index.js。
- id: system-prompt
  name: "@deepseek-ai/dsh-system-prompt"
  config:
    personaPrefix: You are a coding agent powered by the {{model}} model.
    personaSuffix: |
      Your working directory is {{cwd}}.

${indent(text)}
`
writeFileSync('eval/prompts/t-method.yml', yaml)
console.log(`wrote eval/prompts/t-method.yml (${text.length} 字符模板)`)
