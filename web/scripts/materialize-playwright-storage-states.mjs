import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const roles = ['owner', 'admin', 'strategist', 'analyst', 'client']
const outputDirectory = process.env.RUNNER_TEMP
const githubEnvironmentFile = process.env.GITHUB_ENV

if (!outputDirectory || !githubEnvironmentFile) {
  throw new Error('RUNNER_TEMP and GITHUB_ENV are required')
}

await mkdir(outputDirectory, { recursive: true })
const environmentLines = []

for (const role of roles) {
  const variable = `PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE_BASE64`
  const encoded = process.env[variable]
  if (!encoded) throw new Error(`${variable} is required`)

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const state = JSON.parse(decoded)
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error(`${variable} does not contain a Playwright storage state`)
  }

  const path = join(outputDirectory, `yodev-ads-${role}-storage-state.json`)
  await writeFile(path, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  environmentLines.push(`PLAYWRIGHT_${role.toUpperCase()}_STORAGE_STATE=${path}`)
}

await writeFile(githubEnvironmentFile, `${environmentLines.join('\n')}\n`, { flag: 'a' })
