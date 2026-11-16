/**
 * 验证：Cordis 的 ctx.extend({[symbol]: value}) 之后，那个 symbol 是否出现在
 * Object.getOwnPropertySymbols(scopedCtx) 里。
 */
const { Context } = await import('../test/deps/dsh/node_modules/@deepseek-ai/cordis/lib/index.js')

const kScope = Symbol('dsh.scope')
const fakeKey = { id: 'scope-key' }

const root = new Context()
const scoped = root.extend({ [kScope]: fakeKey })

const symbols = Object.getOwnPropertySymbols(scoped)
console.log('scoped 上的 symbol 数:', symbols.length)
console.log('描述:', symbols.map((symbol) => String(symbol)).join(' | '))
console.log('含 kScope:', symbols.includes(kScope))
console.log('取值 === 原值:', scoped[kScope] === fakeKey)

const objects = symbols.map((symbol) => scoped[symbol]).filter((value) => value && typeof value === 'object')
console.log('object 值候选数:', objects.length, '| 含目标:', objects.includes(fakeKey))

console.log('root 上含 kScope:', Object.getOwnPropertySymbols(root).includes(kScope))

let cursor = scoped
const inherited = []
while (cursor && cursor !== Object.prototype) {
  for (const symbol of Object.getOwnPropertySymbols(cursor)) inherited.push(String(symbol))
  cursor = Object.getPrototypeOf(cursor)
}
console.log('原型链上的 symbol:', [...new Set(inherited)].join(' | '))