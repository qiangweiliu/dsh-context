const isIndex = (key) => /^(?:0|[1-9]\d*)$/u.test(key)

export function getPointer(value, pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string')
  if (pointer === '') return value
  if (!pointer.startsWith('/')) throw new Error('pointer must start with /')
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (Array.isArray(current)) {
      if (!isIndex(key)) throw new Error('invalid array index: ' + key)
      const index = Number(key)
      if (index >= current.length) throw new Error('index out of range: ' + key)
      current = current[index]
      continue
    }
    if (current === null || typeof current !== 'object') throw new Error('cannot descend into ' + typeof current)
    if (!Object.prototype.hasOwnProperty.call(current, key)) throw new Error('missing key: ' + key)
    current = current[key]
  }
  return current
}
