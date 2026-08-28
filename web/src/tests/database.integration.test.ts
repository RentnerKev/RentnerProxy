import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { db } from '../db'
import { systemSettings } from '../db/schema'
import { getDatabaseUrl } from '../server/env.server'
import { checkDatabaseHealth } from '../server/Foundation/database-health.server'

const integrationTest =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() ? test : test.skip

describe('PostgreSQL integration', () => {
    integrationTest(
        'uses PostgreSQL 18, the application schema, and the updated_at trigger',
        async () => {
            const key = `integration.${Date.now()}.${Math.random().toString(16).slice(2)}`
            let inserted = false

            try {
                expect(await checkDatabaseHealth()).toEqual({ state: 'connected' })

                const versionRows =
                    await db.$client`SELECT current_setting('server_version_num')::integer AS version`
                expect(versionRows[0]?.version).toBeGreaterThanOrEqual(180_000)

                const namespaceRows = await db.$client`
        SELECT
          to_regclass('public.system_settings') IS NULL AS public_table_missing,
          to_regclass('rentnerproxy.system_settings') IS NOT NULL AS application_table_exists,
          (
            SELECT namespace.nspname
            FROM pg_proc AS procedure
            INNER JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
            WHERE procedure.proname = 'rentnerproxy_set_system_settings_updated_at'
          ) AS function_schema
      `
                expect(namespaceRows[0]).toMatchObject({
                    public_table_missing: true,
                    application_table_exists: true,
                    function_schema: 'rentnerproxy',
                })

                const createdRows = await db
                    .insert(systemSettings)
                    .values({ key, value: { enabled: true } })
                    .returning()
                inserted = true
                const created = createdRows[0]

                expect(created).toBeDefined()

                if (!created) {
                    throw new Error('system setting was not returned after insert')
                }

                expect(created.id[14]).toBe('7')
                expect(created.createdAt).toBeInstanceOf(Date)
                expect(created.updatedAt).toBeInstanceOf(Date)

                await Bun.sleep(10)

                const updatedRows = await db
                    .update(systemSettings)
                    .set({ value: { enabled: false } })
                    .where(eq(systemSettings.key, key))
                    .returning({ updatedAt: systemSettings.updatedAt })
                const updated = updatedRows[0]

                expect(updated).toBeDefined()

                if (!updated) {
                    throw new Error('system setting was not returned after update')
                }

                expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
            } finally {
                if (inserted) {
                    await db.delete(systemSettings).where(eq(systemSettings.key, key))
                }
            }
        },
    )
})
