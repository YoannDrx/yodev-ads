import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(process.cwd())
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
if (!configPath) throw new Error('tsconfig.json not found')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const transactionFunctions = new Set(['withTenantTransaction', 'withSystemTransaction', 'withPurgeTransaction'])
const violations: string[] = []

function calledName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function isPromiseAll(node: ts.Node) {
  return ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Promise' &&
    node.expression.name.text === 'all'
}

for (const fileName of parsed.fileNames.filter((name) => name.includes(`${resolve(root, 'src')}/`))) {
  const source = ts.createSourceFile(fileName, readFileSync(fileName, 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && transactionFunctions.has(calledName(node.expression) ?? '')) {
      const callback = [...node.arguments].reverse().find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      if (callback) {
        const inspectCallback = (candidate: ts.Node) => {
          if (candidate !== callback && (ts.isFunctionDeclaration(candidate) || ts.isFunctionExpression(candidate) || ts.isArrowFunction(candidate))) return
          if (isPromiseAll(candidate)) {
            const position = source.getLineAndCharacterOfPosition(candidate.getStart(source))
            violations.push(`${relative(root, fileName)}:${position.line + 1}:${position.character + 1}`)
          }
          candidate.forEachChild(inspectCallback)
        }
        callback.forEachChild(inspectCallback)
      }
    }
    node.forEachChild(visit)
  }
  source.forEachChild(visit)
}

if (violations.length > 0) {
  throw new Error(`Promise.all is forbidden inside a database transaction callback:\n${violations.join('\n')}`)
}

console.log('Database transaction query serialization verified.')
