import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'

import { systemSettings } from '../db/schema'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip

describe('Caddy runtime migration on PostgreSQL', () => {
    integrationTest(
        'has applied the archive schema without an active legacy column or FK',
        async () => {
            const database = getAuthDatabase()
            const columns = await database.execute<{ column_name: string }>(sql`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'rentnerproxy'
              AND table_name = 'proxy_host_legacy_settings'
            ORDER BY ordinal_position
        `)
            expect(columns.map(({ column_name }) => column_name)).toEqual([
                'id',
                'proxy_host_id',
                'advanced_config',
                'unsupported_settings',
                'archived_at',
            ])

            const activeColumn = await database.execute(sql`
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'rentnerproxy'
              AND table_name = 'proxy_hosts'
              AND column_name = 'advanced_config'
        `)
            expect(activeColumn).toHaveLength(0)

            const foreignKeys = await database.execute(sql`
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'rentnerproxy'
              AND t.relname = 'proxy_host_legacy_settings'
              AND c.contype = 'f'
        `)
            expect(foreignKeys).toHaveLength(0)

            const unsupportedActiveSettings = await database.execute<{ count: string }>(sql`
            SELECT count(*)::text AS count
            FROM rentnerproxy.system_settings
            WHERE key LIKE 'proxy_runtime_host_v1:%'
              AND EXISTS (
                SELECT 1
                FROM rentnerproxy.proxy_hosts p
                WHERE key = 'proxy_runtime_host_v1:' || lower(p.id::text)
              )
              AND (value->'httpSettings' ? 'sendTimeoutSeconds'
                OR value->'httpSettings' ? 'keepaliveTimeoutSeconds')
        `)
            expect(Number(unsupportedActiveSettings[0]?.count ?? 0)).toBe(0)

            const obsoletePermissionAssignments = await database.execute<{ count: string }>(sql`
            SELECT count(*)::text AS count
            FROM rentnerproxy.role_permissions rp
            JOIN rentnerproxy.permissions p ON p.id = rp.permission_id
            WHERE p.key = 'proxy_hosts.advanced_config'
        `)
            expect(Number(obsoletePermissionAssignments[0]?.count ?? 0)).toBe(0)
        },
    )

    integrationTest(
        'upgrades legacy rows without losing text, assignments, or supported settings',
        async () => {
            if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test') {
                throw new Error('Migration replay requires the disposable integration database.')
            }
            const migration = await Bun.file(
                'web/drizzle/0012_lying_supreme_intelligence.sql',
            ).text()
            const rollback = new Error('rollback successful migration replay')
            const hostId = '0198d98a-0000-7000-8000-000000000301'
            const whitespaceHostId = '0198d98a-0000-7000-8000-000000000302'
            const certificateId = '0198d98a-0000-7000-8000-000000000303'
            const roleId = '0198d98a-0000-7000-8000-000000000304'
            const orphanId = '0198d98a-0000-7000-8000-000000000305'
            const legacyText = '  # retained legacy configuration\n\treturn 200;\n  '
            const whitespaceText = ' \n\t '
            const hostKey = 'proxy_runtime_host_v1:' + hostId
            const whitespaceHostKey = 'proxy_runtime_host_v1:' + whitespaceHostId
            const orphanKey = 'proxy_runtime_host_v1:' + orphanId
            const globalValue = { version: 1, httpSettings: { sendTimeoutSeconds: 30 } }
            const oldHostValue = {
                version: 1,
                httpSettings: {
                    proxyReadTimeoutSeconds: 90,
                    sendTimeoutSeconds: 12,
                    keepaliveTimeoutSeconds: 25,
                },
            }

            // execute the exact generated upgrade SQL against representative pre-upgrade rows.
            await expect(
                getAuthDatabase().transaction(async (transaction) => {
                    await transaction.execute(
                        sql`DROP TABLE rentnerproxy.proxy_host_legacy_settings`,
                    )
                    await transaction.execute(
                        sql`ALTER TABLE rentnerproxy.proxy_hosts ADD COLUMN advanced_config text`,
                    )
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.certificates (id, name, source, status, issued_at, expires_at, fingerprint)
                VALUES (${certificateId}, 'migration certificate', 'manual', 'valid', now(), now() + interval '1 year', ${'sha256:' + 'a'.repeat(64)})
            `)
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, advanced_config)
                VALUES (${hostId}, 'http', 'migration-test.invalid', 8080, false, ${certificateId}, ${legacyText}),
                       (${whitespaceHostId}, 'http', 'migration-test.invalid', 8081, false, NULL, ${whitespaceText})
            `)
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.host_domains (proxy_host_id, domain)
                VALUES (${hostId}, 'migration-test.invalid')
            `)
                    await transaction
                        .insert(systemSettings)
                        .values([
                            { key: hostKey, value: oldHostValue },
                            { key: orphanKey, value: oldHostValue },
                            { key: 'proxy_runtime_editor_v1', value: globalValue },
                        ])
                        .onConflictDoUpdate({
                            target: systemSettings.key,
                            set: { value: sql`EXCLUDED.value` },
                        })

                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.system_settings (key, value)
                VALUES (${whitespaceHostKey}, jsonb_build_object('version', 1, 'httpSettings',
                    jsonb_build_object('proxyReadTimeoutSeconds', 45, 'sendTimeoutSeconds', 18)))
            `)
                    const globalBefore = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = 'proxy_runtime_editor_v1'`,
                    )
                    const orphanBefore = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = ${orphanKey}`,
                    )
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.permissions (key, name)
                VALUES ('proxy_hosts.advanced_config', 'obsolete advanced permission')
            `)
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.roles (id, key, name)
                VALUES (${roleId}, 'migration-custom-role', 'migration custom role')
            `)
                    await transaction.execute(sql`
                INSERT INTO rentnerproxy.role_permissions (role_id, permission_id)
                SELECT ${roleId}, id FROM rentnerproxy.permissions
                WHERE key IN ('proxy_hosts.advanced_config', 'proxy_hosts.view')
            `)
                    const certificateBefore = await transaction.execute(
                        sql`SELECT * FROM rentnerproxy.certificates WHERE id = ${certificateId}`,
                    )

                    for (const statement of migration.split('--> statement-breakpoint')) {
                        // oxlint-disable-next-line no-await-in-loop -- Preserve migration statement order.
                        await transaction.execute(sql.raw(statement))
                    }

                    const archived = await transaction.execute(sql`
                SELECT proxy_host_id, advanced_config, unsupported_settings
                FROM rentnerproxy.proxy_host_legacy_settings WHERE proxy_host_id IN (${hostId}, ${whitespaceHostId})
                ORDER BY proxy_host_id
            `)
                    expect(archived).toEqual([
                        {
                            proxy_host_id: hostId,
                            advanced_config: legacyText,
                            unsupported_settings: {
                                sendTimeoutSeconds: 12,
                                keepaliveTimeoutSeconds: 25,
                            },
                        },
                        {
                            proxy_host_id: whitespaceHostId,
                            advanced_config: whitespaceText,
                            unsupported_settings: { sendTimeoutSeconds: 18 },
                        },
                    ])
                    const active = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = ${hostKey}`,
                    )
                    expect(active[0]?.value).toEqual({
                        version: 1,
                        httpSettings: { proxyReadTimeoutSeconds: 90 },
                    })
                    const nativeActive = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = ${whitespaceHostKey}`,
                    )
                    expect(nativeActive[0]?.value).toEqual({
                        version: 1,
                        httpSettings: { proxyReadTimeoutSeconds: 45 },
                    })
                    const global = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = 'proxy_runtime_editor_v1'`,
                    )
                    expect(global).toEqual(globalBefore)
                    const orphan = await transaction.execute(
                        sql`SELECT value FROM rentnerproxy.system_settings WHERE key = ${orphanKey}`,
                    )
                    expect(orphan).toEqual(orphanBefore)
                    expect(
                        await transaction.execute(
                            sql`SELECT * FROM rentnerproxy.certificates WHERE id = ${certificateId}`,
                        ),
                    ).toEqual(certificateBefore)
                    const assignments = await transaction.execute(sql`
                SELECT p.certificate_id, d.domain FROM rentnerproxy.proxy_hosts p
                JOIN rentnerproxy.host_domains d ON d.proxy_host_id = p.id WHERE p.id = ${hostId}
            `)
                    expect(assignments).toEqual([
                        { certificate_id: certificateId, domain: 'migration-test.invalid' },
                    ])
                    const customPermissions = await transaction.execute(sql`
                SELECT p.key FROM rentnerproxy.permissions p JOIN rentnerproxy.role_permissions rp ON rp.permission_id = p.id
                WHERE rp.role_id = ${roleId}
            `)
                    expect(customPermissions).toEqual([{ key: 'proxy_hosts.view' }])
                    await transaction.execute(
                        sql`DELETE FROM rentnerproxy.proxy_hosts WHERE id = ${hostId}`,
                    )
                    expect(
                        await transaction.execute(
                            sql`SELECT id FROM rentnerproxy.proxy_host_legacy_settings WHERE proxy_host_id = ${hostId}`,
                        ),
                    ).toHaveLength(1)
                    throw rollback
                }),
            ).rejects.toBe(rollback)
        },
    )
})
