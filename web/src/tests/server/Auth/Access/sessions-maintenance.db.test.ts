import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test.skipIf(!process.env.RENTNERPROXY_SESSIONS_FIXTURE_URL)(
    'session maintenance executes against its dedicated PostgreSQL fixture with explicit RBAC/audit mocks',
    async () => {
        const child = Bun.spawn({
            cmd: [
                process.execPath,
                '--no-env-file',
                resolve(import.meta.dir, 'Fixtures/sessions-maintenance.fixture.ts'),
            ],
            cwd: resolve(import.meta.dir, '../../../../../..'),
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect(exit, stderr).toBe(0)
        expect(stdout).toContain(
            'PASS: 10 targeted PostgreSQL session checks; RBAC and audit persistence explicitly mocked',
        )
    },
    10_000,
)
