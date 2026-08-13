const forbiddenDataImports = ['@/db/schema', '@/db/transactions', 'drizzle-orm'] as const

export type AppDataBoundaryViolation = { file: string; importSource: string }

export function appDataBoundaryViolations(
  files: Array<{ path: string; source: string }>,
  temporaryAllowlist: ReadonlySet<string> = new Set(),
) {
  const violations: AppDataBoundaryViolation[] = []
  for (const file of files) {
    if (temporaryAllowlist.has(file.path)) continue
    for (const importSource of forbiddenDataImports) {
      const escaped = importSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`from\\s+['\"]${escaped}['\"]`).test(file.source)) {
        violations.push({ file: file.path, importSource })
      }
    }
  }
  return violations
}
