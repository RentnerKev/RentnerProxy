import { describe, expect, mock, test } from 'bun:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    accessPolicies,
    accessPolicyBasicAuthAccounts,
    auditEvents,
    hostDomains,
    proxyHosts,
} from '@/db/schema.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { BulkHostAction } from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import { createBulkHostServices } from '@/server/Admin/HostBulkActions/bulk-hosts.service.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { MAX_RUNTIME_PAYLOAD_BYTES } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'

const integrationTest = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' ? test : test.skip

async function rolledBack(check: (transaction: AuthTransaction) => Promise<void>) {
    const rollback = new Error('rollback synthetic bulk fixture')
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            // These boundary fixtures require an empty, explicitly isolated integration database.
            expect((await readProxyRuntimeSnapshot(transaction)).proxyHosts).toHaveLength(0)
            expect((await readProxyRuntimeSnapshot(transaction)).redirectHosts).toHaveLength(0)
            await check(transaction)
            throw rollback
        })
    } catch (error) {
        if (error !== rollback) throw error
    }
}

function servicesFor(transaction: AuthTransaction) {
    const actor: AuthenticatedUser = {
        id: Bun.randomUUIDv7(),
        email: 'bulk-fixture@example.test',
        displayName: 'Bulk fixture',
        permissions: Object.values(PERMISSIONS),
        roles: [],
        profileImageVersion: null,
        themeMode: 'dark',
        language: 'de',
    }
    const reconcile = mock(async () => {
        // Read through a new savepoint after the apply transaction completes, without a controller.
        await transaction.transaction(readProxyRuntimeSnapshot)
        return 'applied' as const
    })
    const services = createBulkHostServices({
        authorize: async () => actor,
        reauthorize: async () => undefined,
        transaction: (run) => transaction.transaction(run),
        savepoint: (nested, run) => nested.transaction(run),
        lock: lockProxyRuntimeSettings,
        read: (nested, _kind, ids) => readProxyHostSummariesInTransaction(nested, ids),
        readTags: readHostTags,
        validate: async () => undefined,
        validateRuntime: readProxyRuntimeSnapshot,
        write: async (nested, _kind, host, action) => {
            if (action.type === 'addTags' || action.type === 'removeTags')
                throw new Error('Only runtime actions belong to this fixture')
            const change =
                action.type === 'enable' || action.type === 'disable'
                    ? { enabled: action.type === 'enable' }
                    : action.type === 'certificate'
                      ? { certificateId: action.certificateId }
                      : { accessPolicyId: action.accessPolicyId }
            await nested
                .update(proxyHosts)
                .set({ ...change, updatedAt: new Date() })
                .where(eq(proxyHosts.id, host.id))
        },
        audit: appendAuditEventInTransactionService,
        reconcile,
        now: () => 0,
    })
    return { services, reconcile, actor }
}

async function seed(
    transaction: AuthTransaction,
    count: number,
    enabled: number,
    manyDomains = false,
) {
    const ids = Array.from({ length: count }, () => Bun.randomUUIDv7())
    await transaction.insert(proxyHosts).values(
        ids.map((id, index) => ({
            id,
            forwardScheme: 'http' as const,
            forwardHost: '127.0.0.1',
            forwardPort: 8080,
            enabled: index < enabled,
        })),
    )
    if (manyDomains) {
        // Generate the same 50,000 long aliases in PostgreSQL without building and
        // transmitting 50 separate Drizzle insert batches on the CI runner.
        await transaction.execute(sql`
            INSERT INTO ${hostDomains} (proxy_host_id, domain)
            SELECT fixture.host_id,
                'host' || (fixture.position - 1)::text || '-d' || alias::text || '.' ||
                repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) ||
                '.example.test'
            FROM unnest(ARRAY[${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
            )}])
                WITH ORDINALITY AS fixture(host_id, position)
            CROSS JOIN generate_series(0, 49) AS alias
        `)
    } else {
        await transaction.insert(hostDomains).values(
            ids.map((proxyHostId, index) => ({
                proxyHostId,
                domain: 'host' + index + '.bulk-fixture.example.test',
            })),
        )
    }
    return ids
}

async function applyPair(transaction: AuthTransaction, ids: string[], action: BulkHostAction) {
    const { services, reconcile, actor } = servicesFor(transaction)
    const preview = await services.preview({ kind: 'proxy', hostIds: ids, action })
    expect(preview.rows.map((row) => row.status)).toEqual(['ready', 'ready'])
    const result = await services.apply({
        kind: 'proxy',
        action,
        hosts: preview.rows.map((row) => ({ id: row.id, version: row.version })),
    })
    expect(result.rows.map((row) => [row.status, row.reason])).toEqual([
        ['applied', undefined],
        ['skipped', 'invalid'],
    ])
    expect(result.runtimeStatus).toBe('applied')
    expect(reconcile).toHaveBeenCalledTimes(1)
    const audit = await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorUserId, actor.id))
    expect(audit).toHaveLength(1)
    expect(audit[0]?.targetId).toBe(ids[0])
    return result
}

describe('bulk runtime snapshot PostgreSQL savepoints', () => {
    integrationTest(
        'rolls back the 1001st enabled host and its audit while committing the valid first row',
        async () => {
            await rolledBack(async (transaction) => {
                const ids = await seed(transaction, 1001, 999)
                await applyPair(transaction, ids.slice(999), { type: 'enable' })
                expect((await readProxyRuntimeSnapshot(transaction)).proxyHosts).toHaveLength(1000)
                const remaining = await transaction
                    .select({ enabled: proxyHosts.enabled })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, ids[1000]!))
                expect(remaining[0]?.enabled).toBe(false)
            })
        },
    )

    integrationTest(
        'rolls back a policy assignment above the total JSON limit and preserves the fitting assignment',
        async () => {
            await rolledBack(async (transaction) => {
                const ids = await seed(transaction, 1000, 1000, true)
                const policyId = Bun.randomUUIDv7()
                const accounts = Array.from({ length: 32 }, (_, index) => ({
                    username: ('user' + String(index).padStart(2, '0')).padEnd(64, 'x'),
                    passwordHash:
                        '$argon2id$v=19$m=47104,t=1,p=1$' + 'A'.repeat(43) + '$' + 'A'.repeat(43),
                }))
                await transaction.insert(accessPolicies).values({
                    id: policyId,
                    name: 'Synthetic bulk boundary policy',
                    mode: 'authenticated',
                })
                await transaction
                    .insert(accessPolicyBasicAuthAccounts)
                    .values(accounts.map((account) => ({ ...account, policyId })))
                // Earlier tests leave tiny-table statistics; autovacuum cannot see
                // these 50,000 uncommitted aliases before the boundary snapshots.
                await transaction.execute(sql`ANALYZE ${proxyHosts}, ${hostDomains}`)
                const { revision: _revision, ...plain } =
                    await readProxyRuntimeSnapshot(transaction)
                expect(plain.proxyHosts).toHaveLength(1000)
                expect(plain.proxyHosts.reduce((sum, host) => sum + host.domains.length, 0)).toBe(
                    50_000,
                )
                const policy = {
                    id: policyId,
                    mode: 'authenticated',
                    combination: null,
                    basicAuth: { accounts },
                }
                const capacity = Math.floor(
                    (MAX_RUNTIME_PAYLOAD_BYTES - 100 - Buffer.byteLength(JSON.stringify(plain))) /
                        Buffer.byteLength(',"accessPolicy":' + JSON.stringify(policy)),
                )
                expect(capacity).toBeGreaterThan(1)
                expect(capacity).toBeLessThan(999)
                await transaction
                    .update(proxyHosts)
                    .set({ accessPolicyId: policyId })
                    .where(inArray(proxyHosts.id, ids.slice(0, capacity - 1)))
                // applyPair validates both actual savepoint snapshots, then reconciles
                // through a fresh snapshot after the oversized assignment rolls back.
                await applyPair(transaction, ids.slice(capacity - 1, capacity + 1), {
                    type: 'accessPolicy',
                    accessPolicyId: policyId,
                })
                const untouched = await transaction
                    .select({ policy: proxyHosts.accessPolicyId })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, ids[capacity]!))
                expect(untouched[0]?.policy).toBeNull()
            })
        },
        30_000,
    )
})
