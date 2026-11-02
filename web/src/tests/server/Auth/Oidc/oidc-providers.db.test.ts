import { beforeAll, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { OIDC_SETTINGS_KEY } from '@/config/oidc.config.ts'
import { systemSettings } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'
import {
    buildStoredOidcSettings,
    lockStoredOidcSettings,
    readStoredOidcSettings,
    writeStoredOidcSettings,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
beforeAll(() => {
    if (enabled && new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test')
        throw new Error('OIDC provider integration requires the disposable test database.')
})

integrationTest(
    'persists JSON objects and retains global revision after deleting all providers',
    async () => {
        const rollback = new Error('isolated fixture rollback')
        await expect(
            getAuthDatabase().transaction(async (transaction) => {
                await transaction
                    .delete(systemSettings)
                    .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
                const initial = await lockStoredOidcSettings(transaction)
                expect(initial).toEqual({ version: 1, revision: 0, providers: [] })
                const one = await buildStoredOidcSettings(initial, {
                    expectedRevision: 0,
                    providers: [],
                })
                await writeStoredOidcSettings(transaction, one)
                const [row] = await transaction
                    .select({ kind: sql<string>`jsonb_typeof(${systemSettings.value})` })
                    .from(systemSettings)
                    .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
                expect(row?.kind).toBe('object')
                const read = await readStoredOidcSettings(transaction)
                expect(read.revision).toBe(1)
                const two = await buildStoredOidcSettings(read, {
                    expectedRevision: 1,
                    providers: [],
                })
                await writeStoredOidcSettings(transaction, two)
                expect((await lockStoredOidcSettings(transaction)).revision).toBe(2)
                throw rollback
            }),
        ).rejects.toBe(rollback)
    },
)
