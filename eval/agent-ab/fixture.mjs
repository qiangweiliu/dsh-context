// 构建 A/B 对比用的小型仓库夹具；每个任务从同一模板复制，再施加一个确定性变异。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILES = {
  'package.json': `${JSON.stringify({
    name: 'ab-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'node --test', build: 'node src/cli.mjs' },
  }, null, 2)}\n`,
  'README.md': `# AB Fixture\n\nA tiny repository used to compare DSH agents.\n\nRun tests with \`npm test\`.\n`,
  'src/math.mjs': `export function add(a, b) {\n  return a + b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n`,
  'src/text.mjs': `export function slugify(input) {\n  return input\n    .trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, '-')\n    .replace(/^-+|-+$/g, '')\n}\n`,
  'src/time.mjs': `export function humanizeDuration(ms) {\n  if (ms < 1000) return \`\${ms}ms\`\n  return \`\${Math.round(ms / 1000)}s\`\n}\n`,
  'src/config.mjs': `export const DEFAULT_CONFIG = { timeoutMs: 30000, retries: 2 }\n\nexport function withDefaults(overrides = {}) {\n  return { ...DEFAULT_CONFIG, ...overrides }\n}\n`,
  'src/cli.mjs': `import { add } from './math.mjs'\nimport { slugify } from './text.mjs'\nimport { humanizeDuration } from './time.mjs'\nimport { withDefaults } from './config.mjs'\n\nconst config = withDefaults()\nconsole.log(JSON.stringify({\n  sum: add(2, 3),\n  slug: slugify('Hello World'),\n  timeout: humanizeDuration(config.timeoutMs),\n}))\n`,
  'test/math.test.mjs': `import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add, multiply } from '../src/math.mjs'\n\ntest('add', () => assert.equal(add(2, 3), 5))\ntest('multiply', () => assert.equal(multiply(2, 3), 6))\n`,
  'test/text.test.mjs': `import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { slugify } from '../src/text.mjs'\n\ntest('slugify spaces', () => assert.equal(slugify(' Hello World '), 'hello-world'))\ntest('slugify punctuation', () => assert.equal(slugify('A/B: C!'), 'a-b-c'))\ntest('slugify keeps hyphens', () => assert.equal(slugify('already-slugged'), 'already-slugged'))\n`,
  'test/time.test.mjs': `import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { humanizeDuration } from '../src/time.mjs'\n\ntest('milliseconds', () => assert.equal(humanizeDuration(250), '250ms'))\ntest('seconds', () => assert.equal(humanizeDuration(1500), '2s'))\n`,
  'test/config.test.mjs': `import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { DEFAULT_CONFIG, withDefaults } from '../src/config.mjs'\n\ntest('default timeout', () => assert.equal(DEFAULT_CONFIG.timeoutMs, 30000))\ntest('override', () => assert.equal(withDefaults({ retries: 5 }).retries, 5))\n`,
  '.gitignore': `node_modules/\n.env\n`,
}

const taskFiles = {
  orientation: null,
  bugfix: {
    'src/math.mjs': `export function add(a, b) {\n  return a - b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n`,
  },
  feature: {
    'src/text.mjs': `export function slugify(input) {\n  throw new Error('not implemented')\n}\n`,
  },
  refactor: {
    'src/time.mjs': `export function formatDuration(ms) {\n  if (ms < 1000) return \`\${ms}ms\`\n  return \`\${Math.round(ms / 1000)}s\`\n}\n`,
    'src/cli.mjs': `import { add } from './math.mjs'\nimport { slugify } from './text.mjs'\nimport { formatDuration } from './time.mjs'\nimport { withDefaults } from './config.mjs'\n\nconst config = withDefaults()\nconsole.log(JSON.stringify({\n  sum: add(2, 3),\n  slug: slugify('Hello World'),\n  timeout: formatDuration(config.timeoutMs),\n}))\n`,
  },
}

const HARD_FILES = {
  csv: {
    'src/csv.mjs': `export function parseCsv(_text) {\n  throw new Error('not implemented')\n}\n`,
    'test/csv.test.mjs': String.raw`import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '../src/csv.mjs'

test('simple rows', () => assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]))
test('quoted comma', () => assert.deepEqual(parseCsv('a,"b,c"\n1,2'), [['a', 'b,c'], ['1', '2']]))
test('escaped quote', () => assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]))
test('newline inside quotes', () => assert.deepEqual(parseCsv('"line1\nline2",x\n1,2'), [['line1\nline2', 'x'], ['1', '2']]))
test('crlf', () => assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]))
test('empty fields', () => assert.deepEqual(parseCsv('a,,c\n,,'), [['a', '', 'c'], ['', '', '']]))
test('blank input', () => assert.deepEqual(parseCsv(''), []))
`,
  },
  expr: {
    'src/expr.mjs': `export function evaluate(_input) {\n  throw new Error('not implemented')\n}\n`,
    'test/expr.test.mjs': String.raw`import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from '../src/expr.mjs'

test('precedence', () => assert.equal(evaluate('1+2*3'), 7))
test('parentheses', () => assert.equal(evaluate('(1+2)*3'), 9))
test('unary minus', () => assert.equal(evaluate('-2*3'), -6))
test('rhs unary', () => assert.equal(evaluate('2*-3'), -6))
test('double unary', () => assert.equal(evaluate('--2'), 2))
test('decimals', () => assert.equal(evaluate('1.5+2.25'), 3.75))
test('division', () => assert.equal(evaluate('10/4'), 2.5))
test('whitespace', () => assert.equal(evaluate(' 2 + 3 '), 5))
test('divide by zero', () => assert.throws(() => evaluate('1/0')))
test('incomplete', () => assert.throws(() => evaluate('1+')))
test('bad token', () => assert.throws(() => evaluate('abc')))
test('unbalanced', () => assert.throws(() => evaluate('(1+2')))
`,
  },
  lru: {
    'src/lru.mjs': `export class LRU {\n  constructor(_capacity) {\n    throw new Error('not implemented')\n  }\n}\n`,
    'test/lru.test.mjs': String.raw`import test from 'node:test'
import assert from 'node:assert/strict'
import { LRU } from '../src/lru.mjs'

test('get and set', () => {
  const cache = new LRU(2)
  cache.set('a', 1)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('missing'), undefined)
})
test('evicts least recently used', () => {
  const cache = new LRU(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a')
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('c'), 3)
})
test('updating value refreshes recency', () => {
  const cache = new LRU(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('a', 10)
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 10)
})
test('capacity must be positive', () => assert.throws(() => new LRU(0)))
test('size tracks entries', () => {
  const cache = new LRU(2)
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.size, 2)
})
`,
  },
}
for (const [task, files] of Object.entries(HARD_FILES)) taskFiles[task] = files

export const TASKS = {
  orientation: {
    prompt: 'Inspect the repository at the current working directory. Reply with only a JSON object (no prose, no code fence) with keys testCommand (the exact npm script command for tests), branch (current git branch), sourceFileCount (number of .mjs files under src, recursively), and dirtyFile (path of the modified tracked file relative to the repo root).',
    mutation: null,
    verify: async (dir, answer) => {
      const json = answer.match(/\{[\s\S]*\}/)?.[0]
         if (!json) return { pass: false, detail: 'no JSON object in final answer' }
      let value
      try { value = JSON.parse(json) } catch (error) { return { pass: false, detail: `invalid JSON: ${error.message}` } }
      const expected = { branch: 'main', sourceFileCount: 5, dirtyFile: 'README.md' }
      const mismatches = Object.entries(expected).filter(([key, want]) => value[key] !== want)
      // scripts.test 的值（node --test）与调用命令（npm test）都是正确理解，不因表述扣分。
      if (!['npm test', 'node --test'].includes(value.testCommand)) mismatches.push(['testCommand', 'npm test'])
      return { pass: mismatches.length === 0, detail: mismatches.length ? JSON.stringify({ got: value, expected }) : 'exact match' }
    },
  },
  bugfix: {
    prompt: 'The repository test suite is failing. Fix the implementation so `npm test` passes. Do not modify anything under test/. Run the test suite after fixing and report the exact command and final result.',
    mutation: 'bugfix',
    verify: async (dir) => verifyTests(dir, ['test/']),
  },
  feature: {
    prompt: 'Implement slugify in src/text.mjs so that `npm test` passes. Do not modify anything under test/. Run the test suite after implementing and report the exact command and final result.',
    mutation: 'feature',
    verify: async (dir) => verifyTests(dir, ['test/']),
  },
  refactor: {
    prompt: 'The tests expect `humanizeDuration` from src/time.mjs, but the module still exports the old name `formatDuration`. Rename the API consistently across src/ and make `npm test` pass. Do not modify anything under test/. Run the test suite after the change and report the exact command and final result.',
    mutation: 'refactor',
    verify: async (dir) => {
      const result = await verifyTests(dir, ['test/'])
      if (!result.pass) return result
      const cli = readFileSync(join(dir, 'src/cli.mjs'), 'utf8')
      const time = readFileSync(join(dir, 'src/time.mjs'), 'utf8')
      const stale = /formatDuration/.test(cli) || /formatDuration/.test(time)
      return stale ? { pass: false, detail: 'old export still referenced' } : result
    },
  },
  csv: {
    prompt: 'Implement parseCsv in src/csv.mjs so that `npm test` passes. The tests define the required quoting, escaping, newline, and CRLF behavior. Do not modify anything under test/. Run the test suite after implementing and report the exact command and final result.',
    mutation: 'csv',
    verify: async (dir) => verifyTests(dir, ['test/']),
  },
  expr: {
    prompt: 'Implement evaluate in src/expr.mjs so that `npm test` passes. The tests define precedence, parentheses, unary minus, decimals, and error behavior. Do not modify anything under test/. Run the test suite after implementing and report the exact command and final result.',
    mutation: 'expr',
    verify: async (dir) => verifyTests(dir, ['test/']),
  },
  lru: {
    prompt: 'Implement the LRU class in src/lru.mjs so that `npm test` passes. The tests define get/set, eviction order, updates, capacity validation, and size. Do not modify anything under test/. Run the test suite after implementing and report the exact command and final result.',
    mutation: 'lru',
    verify: async (dir) => verifyTests(dir, ['test/']),
  },
}

async function verifyTests(dir, protectedPaths) {
  try {
    execFileSync('npm', ['test'], { cwd: dir, stdio: 'pipe', timeout: 60000 })
  } catch (error) {
    return { pass: false, detail: `npm test failed: ${String(error.stdout || error.message).slice(-300)}` }
  }
  for (const path of protectedPaths) {
    const changed = execFileSync('git', ['status', '--porcelain', '--', path], { cwd: dir, encoding: 'utf8' }).trim()
    if (changed) return { pass: false, detail: `protected path modified: ${changed}` }
  }
  return { pass: true, detail: 'npm test passed; protected paths untouched' }
}

export function createFixture(destination, task, { dirty = false } = {}) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(destination, path)), { recursive: true })
    writeFileSync(join(destination, path), content)
  }
  const mutation = TASKS[task]?.mutation
  if (mutation && taskFiles[mutation]) {
    for (const [path, content] of Object.entries(taskFiles[mutation])) writeFileSync(join(destination, path), content)
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: destination })
  execFileSync('git', ['add', '-A'], { cwd: destination })
  execFileSync('git', ['-c', 'user.name=AB Test', '-c', 'user.email=ab@example.invalid', 'commit', '-qm', 'fixture'], { cwd: destination })
  if (dirty) {
    const readme = readFileSync(join(destination, 'README.md'), 'utf8')
    writeFileSync(join(destination, 'README.md'), `${readme}\nLocal note: do not commit.\n`)
  }
}

export { HARD_FILES }
