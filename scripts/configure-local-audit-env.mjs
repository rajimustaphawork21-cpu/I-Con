import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const environmentPath = join(repositoryRoot, '.env.local')
const temporaryPath = join(repositoryRoot, '.env.local.audit-tmp')

const password = process.env.ICON_AUDIT_DB_PASSWORD
const reconcilerPassword = process.env.ICON_AUDIT_RECONCILER_DB_PASSWORD

if (
  !password ||
  !/^[a-f0-9]{64}$/.test(password) ||
  !reconcilerPassword ||
  !/^[a-f0-9]{64}$/.test(reconcilerPassword)
) {
  throw new Error('Generated 64-character hexadecimal audit passwords are required')
}

const updates = new Map([
  ['ICON_AUDIT_DB_HOST', '127.0.0.1'],
  ['ICON_AUDIT_DB_PORT', '5432'],
  ['ICON_AUDIT_DB_NAME', 'icon_audit'],
  ['ICON_AUDIT_DB_USER', 'icon_audit_runtime'],
  ['ICON_AUDIT_DB_PASSWORD', password],
  ['ICON_AUDIT_DB_SSL_MODE', 'disable'],
  ['ICON_AUDIT_RECONCILER_DB_USER', 'icon_audit_reconciler'],
  ['ICON_AUDIT_RECONCILER_DB_PASSWORD', reconcilerPassword],
  ['ICON_AUDIT_TEST_DB_NAME', 'icon_audit_test']
])

let source = ''

try {
  source = await readFile(environmentPath, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const seen = new Set()
const lines = source.split(/\r?\n/).map(line => {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)

  if (!match || !updates.has(match[1])) return line

  seen.add(match[1])

  return match[1] + '=' + updates.get(match[1])
})

if (lines.length > 0 && lines.at(-1) !== '') lines.push('')
if (![...seen].some(name => name.startsWith('ICON_AUDIT_'))) {
  lines.push('# Server-only PostgreSQL audit database')
}

for (const [name, value] of updates) {
  if (!seen.has(name)) lines.push(name + '=' + value)
}

lines.push('')
await writeFile(temporaryPath, lines.join('\n'), { mode: 0o600 })
await rename(temporaryPath, environmentPath)
await chmod(environmentPath, 0o600)
