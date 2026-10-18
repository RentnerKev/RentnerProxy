import { describe, expect, test } from 'bun:test'
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
