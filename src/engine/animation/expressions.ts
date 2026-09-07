type Expression = (variables: Record<string, number>) => number
const functions: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
  pow: Math.pow, clamp: (value, min, max) => Math.max(min!, Math.min(max!, value!)),
}
const cache = new Map<string, Expression>()

/** A small arithmetic grammar, never JavaScript evaluation or access to objects/browser APIs. */
export function compileExpression(source: string): Expression {
  const cached = cache.get(source)
  if (cached) return cached
  if (source.length > 512) throw new Error('Expression is too long')
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_]+|\S/g) ?? []
  let cursor = 0
  const take = () => tokens[cursor++]
  const require = (token: string) => { if (take() !== token) throw new Error(`Expected ${token}`) }
  const parse = (minimum = 0): Expression => {
    const token = take()
    let left: Expression
    if (token === '+' || token === '-') {
      const operand = parse(4); left = vars => (token === '-' ? -1 : 1) * operand(vars)
    } else if (token === '(') { left = parse(); require(')') }
    else if (token && Number.isFinite(Number(token))) { const number = Number(token); left = () => number }
    else if (token && functions[token]) {
      require('(')
      const args: Expression[] = []
      if (tokens[cursor] !== ')') {
        args.push(parse())
        while (tokens[cursor] === ',') { take(); args.push(parse()) }
      }
      require(')')
      left = vars => functions[token]!(...args.map(arg => arg(vars)))
    } else if (token && ['time', 'value', 'source', 'pi'].includes(token)) { left = vars => token === 'pi' ? Math.PI : vars[token] ?? 0 }
    else throw new Error(`Unknown value: ${token ?? 'end of expression'}`)
    for (;;) {
      const operator = tokens[cursor]
      const precedence = operator === '+' || operator === '-' ? 1 : operator === '*' || operator === '/' || operator === '%' ? 2 : operator === '^' ? 3 : -1
      if (precedence < minimum) break
      take()
      const right = parse(precedence + (operator === '^' ? 0 : 1)), previous = left
      left = vars => {
        const a = previous(vars), b = right(vars)
        switch (operator) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; default: return a ** b }
      }
    }
    return left
  }
  const result = parse()
  if (cursor !== tokens.length) throw new Error(`Unexpected token: ${tokens[cursor]}`)
  if (cache.size > 256) cache.clear()
  cache.set(source, result)
  return result
}
