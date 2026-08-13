export type DatabaseDoubleCapture = {
  sets: unknown[]
  values: unknown[]
}

type FluentStatement = Record<string | symbol, unknown>

function fluentStatement(result: unknown, capture: DatabaseDoubleCapture): FluentStatement {
  const statement: FluentStatement = {}
  const proxy = new Proxy(statement, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        if (property === 'set') capture.sets.push(args[0])
        if (property === 'values') capture.values.push(args[0])
        if (property === 'returning') return Promise.resolve(result)
        return proxy
      }
    },
  })
  return proxy
}

export function databaseDouble(input: {
  statementResults?: unknown[]
  query?: Record<string, Record<string, (...args: unknown[]) => unknown>>
} = {}) {
  const capture: DatabaseDoubleCapture = { sets: [], values: [] }
  const results = [...(input.statementResults ?? [])]
  const nextStatement = () => fluentStatement(results.shift() ?? [], capture)
  return {
    db: {
      select: nextStatement,
      insert: nextStatement,
      update: nextStatement,
      delete: nextStatement,
      execute: nextStatement,
      query: input.query ?? {},
    },
    capture,
  }
}
