function tokenize(input) {
  const tokens = []
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (/\s/u.test(ch)) continue
    if ('+-*/()'.includes(ch)) { tokens.push(ch); continue }
    if (/[0-9.]/u.test(ch)) {
      let start = i
      while (i < input.length && /[0-9.]/u.test(input[i])) i += 1
      const raw = input.slice(start, i)
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw)) throw new Error('bad number: ' + raw)
      tokens.push(Number(raw))
      i -= 1
      continue
    }
    throw new Error('bad token: ' + ch)
  }
  return tokens
}

export function evaluate(input) {
  const tokens = tokenize(input)
  let at = 0
  const peek = () => tokens[at]
  const eat = (value) => { if (tokens[at] !== value) throw new Error('expected ' + value); at += 1 }
  function primary() {
    const token = peek()
    if (token === '(') { eat('('); const value = expression(); eat(')'); return value }
    if (typeof token === 'number') { at += 1; return token }
    throw new Error('unexpected token')
  }
  function unary() {
    const token = peek()
    if (token === '+') { at += 1; return unary() }
    if (token === '-') { at += 1; return -unary() }
    return primary()
  }
  function term() {
    let value = unary()
    for (;;) {
      const token = peek()
      if (token !== '*' && token !== '/') return value
      at += 1
      const right = unary()
      if (token === '/') { if (right === 0) throw new Error('division by zero'); value /= right } else value *= right
    }
  }
  function expression() {
    let value = term()
    for (;;) {
      const token = peek()
      if (token !== '+' && token !== '-') return value
      at += 1
      const right = term()
      value = token === '+' ? value + right : value - right
    }
  }
  if (tokens.length === 0) throw new Error('empty expression')
  const value = expression()
  if (at !== tokens.length) throw new Error('trailing token')
  return value
}
