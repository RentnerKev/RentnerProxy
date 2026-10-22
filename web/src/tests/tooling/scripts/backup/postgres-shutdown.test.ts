import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { postgresShutdownScript } from '../../../../../../scripts/backup/postgres-shutdown.ts'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'
import { postgresCommand } from '../../../../../../scripts/production-restore.ts'

const cwd = resolve(import.meta.dir, '../../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

describe('maintenance PostgreSQL shell shutdown', () => {
    test.each([false, true])(
        'reaps only its owned child when TERM is ignored=%s',
        async (ignoreTerm) => {
            const script = [
                'set -Eeuo pipefail',
                'ready=$(mktemp)',
                'sleep 60 & unrelated=$!',
                'trap \'kill -KILL "$unrelated" "${postgres_pid:-}" 2>/dev/null || true; wait 2>/dev/null || true; rm -f "$ready"\' EXIT',
                `bash -c '${ignoreTerm ? 'trap "" TERM; ' : ''}echo ready > "$1"; exec sleep 60' fixture "$ready" & postgres_pid=$!`,
                'for attempt in $(seq 1 100); do [[ -s $ready ]] && break; sleep 0.01; done',
                'test -s "$ready"',
                postgresShutdownScript(1),
                'stop_postgres',
                '! kill -0 "$postgres_pid" 2>/dev/null',
                'kill -0 "$unrelated"',
                'printf done',
            ].join('\n')
            const result = await runMaintenanceProcess(
                [bash, '--noprofile', '--norc', '-c', script],
                { cwd, timeoutMs: 3_000 },
            )
            expect(result.failed).toBe(false)
            expect(result.timedOut).toBe(false)
            expect(Buffer.from(result.stdout).toString()).toBe('done')
        },
    )

    test('both restore paths include the bounded cleanup before installing their exit trap', () => {
        for (const validateOnly of [false, true]) {
            const script = postgresCommand(validateOnly)
            expect(script).toContain('local deadline=$((SECONDS + 5))')
            expect(script).toContain('kill -KILL "$postgres_pid"')
            expect(script.indexOf('stop_postgres()')).toBeLessThan(
                script.indexOf('trap cleanup EXIT'),
            )
            expect(script).toContain('stop_postgres; }')
        }
    })
})
