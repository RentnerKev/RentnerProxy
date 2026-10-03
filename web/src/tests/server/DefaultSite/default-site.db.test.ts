import { describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'

import { systemSettings } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import {
    DEFAULT_SITE_SETTINGS_KEY,
    readDefaultSiteSettings,
    writeDefaultSiteSettings,
} from '@/server/DefaultSite/default-site-settings.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import {
    lockProxyRuntimeSettings,
    readProxyHttpSettings,
    writeProxyHttpSettings,
} from '@/server/ProxyRuntime/proxy-runtime-settings.ts'

const integrationTest = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' ? test : test.skip

async function rolledBack(check: (transaction: AuthTransaction) => Promise<void>) {
    const rollback = new Error('rollback default site test')
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await check(transaction)
            throw rollback
        })
    } catch (error) {
        if (error !== rollback) throw error
    }
}

describe('default site durable JSONB settings', () => {
    integrationTest(
        'defaults to 404, persists exact HTML and projects it into the desired snapshot',
        async () => {
            await rolledBack(async (transaction) => {
                await transaction
                    .delete(systemSettings)
                    .where(eq(systemSettings.key, DEFAULT_SITE_SETTINGS_KEY))
                await lockProxyRuntimeSettings(transaction)
                expect(await readDefaultSiteSettings(transaction)).toEqual({ mode: 'not-found' })
                const settings = {
                    mode: 'custom-html' as const,
                    html: '<p>Gude äß {env.LITERAL}</p>\n',
                }
                await writeDefaultSiteSettings(transaction, settings)
                expect(await readDefaultSiteSettings(transaction)).toEqual(settings)
                const snapshot = await readProxyRuntimeSnapshot(transaction)
                expect(snapshot.defaultSite).toEqual(settings)
                const rows = await transaction.execute<{ kind: string }>(sql`
                SELECT jsonb_typeof(value) AS kind FROM rentnerproxy.system_settings
                WHERE key = ${DEFAULT_SITE_SETTINGS_KEY}
            `)
                expect(rows[0]?.kind).toBe('object')
                await writeDefaultSiteSettings(transaction, { mode: 'not-found' })
                expect((await readProxyRuntimeSnapshot(transaction)).defaultSite).toBeUndefined()
                expect((await readProxyRuntimeSnapshot(transaction)).revision).not.toBe(
                    snapshot.revision,
                )
            })
        },
    )

    integrationTest(
        'keeps default site and HTTP editor updates independent, including a restored JSON value',
        async () => {
            await rolledBack(async (transaction) => {
                await lockProxyRuntimeSettings(transaction)
                await writeDefaultSiteSettings(transaction, {
                    mode: 'redirect',
                    url: 'https://example.com/fallback',
                })
                await writeProxyHttpSettings(transaction, { proxyReadTimeoutSeconds: 120 })
                expect(await readDefaultSiteSettings(transaction)).toEqual({
                    mode: 'redirect',
                    url: 'https://example.com/fallback',
                })
                const [stored] = await transaction
                    .select({ value: systemSettings.value })
                    .from(systemSettings)
                    .where(eq(systemSettings.key, DEFAULT_SITE_SETTINGS_KEY))
                    .limit(1)
                expect(stored).toBeDefined()
                await transaction
                    .delete(systemSettings)
                    .where(eq(systemSettings.key, DEFAULT_SITE_SETTINGS_KEY))
                const restored = JSON.parse(JSON.stringify(stored!.value))
                await transaction
                    .insert(systemSettings)
                    .values({ key: DEFAULT_SITE_SETTINGS_KEY, value: sql`${restored}` })
                expect(await readDefaultSiteSettings(transaction)).toEqual({
                    mode: 'redirect',
                    url: 'https://example.com/fallback',
                })
                await writeDefaultSiteSettings(transaction, { mode: 'welcome' })
                expect(await readProxyHttpSettings(transaction)).toEqual({
                    proxyReadTimeoutSeconds: 120,
                })
            })
        },
    )
})
