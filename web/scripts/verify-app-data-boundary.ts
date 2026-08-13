import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { appDataBoundaryViolations } from '../src/lib/data-boundary'

const projectRoot = resolve(process.cwd())
const appRoot = resolve(projectRoot, 'src/app')
const migrationAllowlist = new Set<string>()

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

async function main() {
  const files = await Promise.all((await sourceFiles(appRoot)).map(async (path) => ({
    path: relative(projectRoot, path),
    source: await readFile(path, 'utf8'),
  })))
  const violations = appDataBoundaryViolations(files, migrationAllowlist)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}: direct import of ${violation.importSource} is forbidden; use a server repository/service.`)
    }
    process.exitCode = 1
  } else {
    console.log(`App data boundary verified (${files.length} files, allowlist: ${[...migrationAllowlist].join(', ') || 'none'}).`)
  }
}

void main()
