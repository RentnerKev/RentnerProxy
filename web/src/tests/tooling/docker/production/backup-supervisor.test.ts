import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'

test.skipIf(process.platform !== 'linux')(
    'backup supervisor preserves lifecycle and failure fences',
    async () => {
        const root = fileURLToPath(new URL('../../../../../..', import.meta.url))
        const result = await runMaintenanceProcess(['bash', 'docker/production/tests/backups.sh'], {
            cwd: root,
            timeoutMs: 15_000,
            maximumOutputBytes: 65_536,
        })
        expect(result.failed).toBe(false)
        expect(result.stopped).toBe(true)
        expect(Buffer.from(result.stdout).toString('utf8')).toContain('PASS:')
    },
    20_000,
)
