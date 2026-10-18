import { describe, expect, test } from 'bun:test'
import { postgresCommand } from '../../../../scripts/production-restore.ts'
import { NOTIFICATION_SETTINGS_KEY, NOTIFICATION_STATE_KEY } from '@/config/notifications.config.ts'

describe('notification restore pause command contract', () => {
    test('pauses configuration and removes queued state in the actual restore transaction', () => {
        const command = postgresCommand(false)
        const pause = command.indexOf('UPDATE rentnerproxy.system_settings SET value =')
        const cancel = command.indexOf('DELETE FROM rentnerproxy.system_settings')
        const execute = command.indexOf('psql --host=')
        expect(pause).toBeGreaterThan(command.indexOf('cat "$rendered_sql_path"'))
        expect(cancel).toBeGreaterThan(pause)
        expect(execute).toBeGreaterThan(cancel)
        expect(command).toContain("'{enabled}', 'false'::jsonb")
        expect(command).toContain("'{pausedAfterRestore}', 'true'::jsonb")
        expect(command).toContain("least((value->>'revision')::bigint + 1, 4294967295)")
        expect(command).toContain("WHERE key = '" + NOTIFICATION_SETTINGS_KEY + "';")
        expect(command).toContain("WHERE key = '" + NOTIFICATION_STATE_KEY + "';")
        expect(command).toContain('--single-transaction --set=ON_ERROR_STOP=1')
        expect(command).toContain('--username=rentnerproxy --dbname=rentnerproxy')
        expect(command).not.toContain('SET channels')
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
