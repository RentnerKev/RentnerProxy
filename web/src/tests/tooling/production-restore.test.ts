import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { postgresCommand } from '../../../../scripts/production-restore.ts'
import { NOTIFICATION_SETTINGS_KEY, NOTIFICATION_STATE_KEY } from '@/config/notifications.config.ts'

describe('notification restore pause command contract', () => {
    test('pauses configuration and removes queued state in the actual restore transaction', () => {
        const command = postgresCommand(false)
        const pause = command.indexOf('UPDATE rentnerproxy.system_settings AS settings SET value =')
        const cancel = command.indexOf('DELETE FROM rentnerproxy.system_settings')
        const execute = command.indexOf('psql --host=')
        expect(pause).toBeGreaterThan(command.indexOf('cat "$rendered_sql_path"'))
        expect(cancel).toBeGreaterThan(pause)
        expect(execute).toBeGreaterThan(cancel)
        expect(command).toContain("'{enabled}', 'false'::jsonb")
        expect(command).toContain("'{pausedAfterRestore}', 'true'::jsonb")
        expect(command).toContain("least((normalized.value->>'revision')::bigint + 1, 4294967295)")
        expect(command).toContain("WHERE key = '" + NOTIFICATION_SETTINGS_KEY + "'")
        expect(command).toContain("WHERE key = '" + NOTIFICATION_STATE_KEY + "';")
        expect(command).toContain('--single-transaction --set=ON_ERROR_STOP=1')
        expect(command).toContain('--username=rentnerproxy --dbname=rentnerproxy')
        expect(command).not.toContain('SET channels')
    })

    test('normalizes JSONB objects and serialized objects once before pausing the same row', () => {
        const command = postgresCommand(false)
        const sql = command
            .split("<<'RESTORE_NOTIFICATION_SQL'\n")[1]
            ?.split('\nRESTORE_NOTIFICATION_SQL')[0]
        expect(sql).toBeDefined()
        expect(sql).toContain('WITH normalized AS MATERIALIZED (')
        expect(sql).toContain(
            "SELECT id, CASE jsonb_typeof(value) WHEN 'string' THEN (value #>> '{}')::jsonb ELSE value END AS value",
        )
        expect(sql?.match(/CASE jsonb_typeof\(value\)/gu)).toHaveLength(1)
        expect(sql).toContain('jsonb_set(jsonb_set(jsonb_set(normalized.value,')
        expect(sql).toContain("least((normalized.value->>'revision')::bigint + 1, 4294967295)")
        expect(sql).toContain('FROM normalized WHERE settings.id = normalized.id;')
        expect(sql).not.toContain("(value->>'revision')")
    })

    test('isolated validation keeps notification configuration and queue unchanged', () => {
        const command = postgresCommand(true)
        expect(command).not.toContain(NOTIFICATION_SETTINGS_KEY)
        expect(command).not.toContain(NOTIFICATION_STATE_KEY)
        expect(command).not.toContain('RESTORE_NOTIFICATION_SQL')
        expect(command).toContain('data_directory=/tmp/backup-postgres')
        expect(command).toContain('bun /opt/rentnerproxy/web/docker/web/validate-backup.ts')
    })
})

describe('restore target maintenance entrypoint', () => {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
    const entrypoint = readFile(
        new URL('../../../../docker/production/entrypoint.sh', import.meta.url),
        'utf8',
    )

    test.each([false, true])(
        'database preparation (failure: %s) never starts application consumers',
        async (failure) => {
            const source = await entrypoint
            const maintenance = /^initialize_restore_target\(\) \{[\s\S]*?^\}/mu.exec(source)?.[0]
            expect(maintenance).toBeDefined()
            const dispatcher = source.slice(source.indexOf('trap shutdown_children EXIT'))
            const steps = [
                'initialize_layout',
                'initialize_secrets',
                'initialize_postgres_data_directory',
                'start_postgres',
                'start_crowdsec_supervisor',
                'start_controller',
                'start_valkey',
                'run_migrations',
                'start_web',
                'monitor_children',
                'shutdown_children',
            ]
            const probes = steps
                .map(
                    (step) =>
                        `${step}() { printf '%s\n' '${step}'; ${failure && step === 'start_postgres' ? 'return 7;' : ':;'} }`,
                )
                .join('\n')
            const script = [
                'set -Eeuo pipefail',
                probes,
                'on_shutdown_signal() { exit 1; }',
                maintenance,
                dispatcher,
            ].join('\n')
            const child = Bun.spawn(
                [
                    bash,
                    '--noprofile',
                    '--norc',
                    '-c',
                    script,
                    'restore-fixture',
                    '--initialize-restore-target',
                ],
                { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
            )
            const [exit, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            expect(stderr).toBe('')
            expect(exit).toBe(failure ? 7 : 0)
            expect(stdout.trim().split('\n')).toEqual([
                'initialize_layout',
                'initialize_secrets',
                'initialize_postgres_data_directory',
                'start_postgres',
                'shutdown_children',
            ])
        },
    )
})
