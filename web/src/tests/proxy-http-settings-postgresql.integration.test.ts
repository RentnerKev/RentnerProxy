import { describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'

import { systemSettings } from '../db/schema'
import { getAuthDatabase, type AuthTransaction } from '../server/Auth/Core/database.server'
import {
    lockProxyRuntimeSettings,
    PROXY_RUNTIME_SETTINGS_KEY,
    readProxyHttpSettings,
    readProxyHostHttpSettings,
    readProxyHostHttpSettingsMap,
    writeProxyHttpSettings,
    writeProxyHostHttpSettings,
} from '../server/ProxyRuntime/proxy-runtime-settings'

const integrationTest = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' ? test : test.skip

async function rolledBack(check: (transaction: AuthTransaction) => Promise<void>) {
    const rollback = new Error('rollback test changes')
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await check(transaction)
            throw rollback
        })
    } catch (error) {
        if (error !== rollback) throw error
    }
}

describe('HTTP settings JSONB persistence', () => {
    integrationTest(
        'creates and updates global settings as JSON objects readable in the same transaction',
        async () => {
            await rolledBack(async (transaction) => {
                await transaction
                    .delete(systemSettings)
                    .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
                await lockProxyRuntimeSettings(transaction)
                expect(await readProxyHttpSettings(transaction)).toEqual({})
                await writeProxyHttpSettings(transaction, { proxyReadTimeoutSeconds: 120 })
                expect(await readProxyHttpSettings(transaction)).toEqual({
                    proxyReadTimeoutSeconds: 120,
                })
                const rows = await transaction.execute<{ kind: string }>(sql`
                SELECT jsonb_typeof(value) AS kind FROM rentnerproxy.system_settings
                WHERE key = ${PROXY_RUNTIME_SETTINGS_KEY}
            `)
                expect(rows[0]?.kind).toBe('object')
                await writeProxyHttpSettings(transaction, {})
                expect(await readProxyHttpSettings(transaction)).toEqual({})
            })
        },
    )

    integrationTest(
        'reads existing JSON-string settings and repairs their representation on save',
        async () => {
            await rolledBack(async (transaction) => {
                await lockProxyRuntimeSettings(transaction)
                const legacy = JSON.stringify({
                    version: 1,
                    httpSettings: { proxyReadTimeoutSeconds: 90 },
                })
                await transaction.execute(sql`
                UPDATE rentnerproxy.system_settings SET value = to_jsonb(${legacy}::text)
                WHERE key = ${PROXY_RUNTIME_SETTINGS_KEY}
            `)
                expect(await readProxyHttpSettings(transaction)).toEqual({
                    proxyReadTimeoutSeconds: 90,
                })
                await writeProxyHttpSettings(transaction, { proxyReadTimeoutSeconds: 120 })
                expect(await readProxyHttpSettings(transaction)).toEqual({
                    proxyReadTimeoutSeconds: 120,
                })
            })
        },
    )

    integrationTest('round-trips host inserts, updates, bulk reads and reset', async () => {
        await rolledBack(async (transaction) => {
            const hostId = crypto.randomUUID()
            await writeProxyHostHttpSettings(transaction, hostId, { proxyReadTimeoutSeconds: 90 })
            expect(await readProxyHostHttpSettings(transaction, hostId)).toEqual({
                proxyReadTimeoutSeconds: 90,
            })
            await writeProxyHostHttpSettings(transaction, hostId, { proxyReadTimeoutSeconds: 120 })
            expect((await readProxyHostHttpSettingsMap(transaction, [hostId])).get(hostId)).toEqual(
                { proxyReadTimeoutSeconds: 120 },
            )
            await writeProxyHostHttpSettings(transaction, hostId, {})
            expect(await readProxyHostHttpSettings(transaction, hostId)).toEqual({})
        })
    })
})
