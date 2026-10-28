import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { db } from '@/db/index.ts'
import {
    auditEvents,
    hostCheckIncidents,
    hostCheckObservations,
    hostCheckPolicies,
    hostDomains,
    permissions,
    proxyHosts,
    rolePermissions,
    roles,
    systemSettings,
    userRoles,
    users,
} from '@/db/schema.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { ensureAuthorizationRegistryInTransaction } from '@/server/Auth/Access/registry.service.ts'
import { createHostMonitoringService } from '@/server/HostMonitoring/host-monitoring.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import {
    lockProxyRuntimeSettings,
    PROXY_RUNTIME_SETTINGS_KEY,
} from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'

function isIsolatedDatabase(): boolean {
    if (process.env.RENTNERPROXY_DATABASE_INTEGRATION !== '1') return false
    const value = getDatabaseUrl()
    if (!value) return false
    try {
        const url = new URL(value)
        return url.hostname === '127.0.0.1' && url.pathname === '/rentnerproxy_upstream_test'
    } catch {
        return false
    }
}
const isolated = isIsolatedDatabase()
const integrationTest = isolated ? test : test.skip
let actorId: string
let roleId: string
let hostId: string
let domain: string
const ownedUsers: string[] = []
const ownedRoles: string[] = []
const ownedHosts: string[] = []

async function grant(permissionKeys: readonly PermissionKey[]) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
    if (!permissionKeys.length) return
    const selected = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys))
    expect(selected).toHaveLength(permissionKeys.length)
    await db
        .insert(rolePermissions)
        .values(selected.map((permission) => ({ roleId, permissionId: permission.id })))
}

function service(rateLimit: (id: string) => Promise<void> = async () => undefined) {
    return createHostMonitoringService({
        database: () => db,
        requireActor: async (permission) => {
            await db.transaction((transaction) =>
                requirePermissionInTransaction(transaction, actorId, permission),
            )
            return { id: actorId }
        },
        rateLimit,
    })
}
function settings() {
    return { ...HOST_MONITORING_DEFAULTS, enabled: true, domain }
}
function input() {
    return { proxyHostId: hostId, expectedVersion: null, settings: settings() }
}
async function policies() {
    return db.select().from(hostCheckPolicies).where(eq(hostCheckPolicies.proxyHostId, hostId))
}
async function audits() {
    return db.select().from(auditEvents).where(eq(auditEvents.targetId, hostId))
}

describe('scheduled monitoring service authorization and persistence', () => {
    beforeAll(async () => {
        if (!isolated) return
        await db.transaction(async (transaction) => {
            await ensureAuthorizationRegistryInTransaction(transaction)
            // Initialize the shared fixture lock row before asserting monitoring cannot alter it.
            await lockProxyRuntimeSettings(transaction)
        })
    })
    beforeEach(async () => {
        if (!isolated) return
        actorId = randomUUID()
        roleId = randomUUID()
        hostId = randomUUID()
        domain = `service-${hostId}.example.test`
        ownedUsers.push(actorId)
        ownedRoles.push(roleId)
        ownedHosts.push(hostId)
        await db.insert(users).values({
            id: actorId,
            displayName: 'Monitoring service fixture',
            email: `${actorId}@monitoring-service.invalid`,
            status: 'active',
            emailVerifiedAt: new Date(),
        })
        await db.insert(roles).values({
            id: roleId,
            key: `monitoring-service-${roleId}`,
            name: 'Monitoring service fixture',
            description: 'Owned integration fixture',
        })
        await db.insert(userRoles).values({ userId: actorId, roleId })
        await grant([PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_UPDATE])
        await db.insert(proxyHosts).values({
            id: hostId,
            forwardScheme: 'http',
            forwardHost: '127.0.0.1',
            forwardPort: 8080,
            enabled: true,
        })
        await db.insert(hostDomains).values({ proxyHostId: hostId, domain })
    })
    afterEach(async () => {
        if (!isolated) return
        if (ownedHosts.length) {
            await db.delete(auditEvents).where(inArray(auditEvents.targetId, ownedHosts))
            await db.delete(proxyHosts).where(inArray(proxyHosts.id, ownedHosts.splice(0)))
        }
        if (ownedUsers.length) {
            await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ownedUsers))
            await db.delete(users).where(inArray(users.id, ownedUsers.splice(0)))
        }
        if (ownedRoles.length) await db.delete(roles).where(inArray(roles.id, ownedRoles.splice(0)))
    })

    integrationTest(
        'VIEW and UPDATE are independently enforced for policies and history',
        async () => {
            await grant([PERMISSIONS.PROXY_HOSTS_VIEW])
            await expect(service().savePolicy(input())).rejects.toMatchObject({
                code: 'permission_denied',
            })
            expect(await service().getPolicy({ proxyHostId: hostId })).toBeNull()
            expect(await service().getHistory({ proxyHostId: hostId })).toEqual({
                observations: [],
                incidents: [],
                nextCursor: null,
            })
            await grant([PERMISSIONS.PROXY_HOSTS_UPDATE])
            await expect(service().getPolicy({ proxyHostId: hostId })).rejects.toMatchObject({
                code: 'permission_denied',
            })
            await expect(service().getHistory({ proxyHostId: hostId })).rejects.toMatchObject({
                code: 'permission_denied',
            })
            // Saving also needs VIEW to prove membership of the selected host.
            await expect(service().savePolicy(input())).rejects.toMatchObject({
                code: 'permission_denied',
            })
            expect(await policies()).toHaveLength(0)
            expect(await audits()).toHaveLength(0)
        },
    )

    integrationTest(
        'a demotion after outer authorization is rechecked inside the write transaction',
        async () => {
            let outerPermissionPassed = false
            const demoted = service(async () => {
                outerPermissionPassed = true
                await grant([PERMISSIONS.PROXY_HOSTS_VIEW])
            })
            await expect(demoted.savePolicy(input())).rejects.toMatchObject({
                code: 'permission_denied',
            })
            expect(outerPermissionPassed).toBe(true)
            expect(await policies()).toHaveLength(0)
            expect(await audits()).toHaveLength(0)
        },
    )

    integrationTest(
        'only an attached domain can be selected and rejected writes leave no policy or audit',
        async () => {
            const foreignHostId = randomUUID()
            ownedHosts.push(foreignHostId)
            const foreignDomain = `foreign-${foreignHostId}.example.test`
            await db.insert(proxyHosts).values({
                id: foreignHostId,
                forwardScheme: 'http',
                forwardHost: '127.0.0.1',
                forwardPort: 8080,
            })
            await db
                .insert(hostDomains)
                .values({ proxyHostId: foreignHostId, domain: foreignDomain })
            await expect(
                service().savePolicy({
                    ...input(),
                    settings: { ...settings(), domain: foreignDomain },
                }),
            ).rejects.toMatchObject({ code: 'invalid_input' })
            expect(await policies()).toHaveLength(0)
            expect(await audits()).toHaveLength(0)
        },
    )

    integrationTest(
        'expectedVersion serializes competing edits and unchanged settings are a complete no-op',
        async () => {
            const monitor = service()
            const original = await monitor.savePolicy(input())
            const beforeNoop = await policies()
            expect(
                await monitor.savePolicy({ ...input(), expectedVersion: original.version }),
            ).toEqual(original)
            expect(await policies()).toEqual(beforeNoop)
            expect(await audits()).toHaveLength(1)
            const edits = await Promise.allSettled(
                [201, 202].map((expectedStatus) =>
                    monitor.savePolicy({
                        ...input(),
                        expectedVersion: original.version,
                        settings: { ...settings(), expectedStatus },
                    }),
                ),
            )
            expect(edits.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
            const rejected = edits.find((result) => result.status === 'rejected')
            expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
            expect((await policies())[0]?.version).not.toBe(original.version)
            await expect(monitor.savePolicy(input())).rejects.toMatchObject({ code: 'conflict' })
            expect(await audits()).toHaveLength(2)
        },
    )

    integrationTest(
        'policy saves audit only monitoring and preserve host configuration, runtime proof and settings',
        async () => {
            const beforeSnapshot = await db.transaction(readProxyRuntimeSnapshot)
            const beforeHosts = await db.select().from(proxyHosts).where(eq(proxyHosts.id, hostId))
            const beforeDomains = await db
                .select()
                .from(hostDomains)
                .where(eq(hostDomains.proxyHostId, hostId))
            const beforeSettings = await db
                .select()
                .from(systemSettings)
                .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
            expect(beforeSettings).toHaveLength(1)
            const policy = await service().savePolicy(input())
            expect(await db.transaction(readProxyRuntimeSnapshot)).toEqual(beforeSnapshot)
            expect(await db.select().from(proxyHosts).where(eq(proxyHosts.id, hostId))).toEqual(
                beforeHosts,
            )
            expect(
                await db.select().from(hostDomains).where(eq(hostDomains.proxyHostId, hostId)),
            ).toEqual(beforeDomains)
            expect(
                await db
                    .select()
                    .from(systemSettings)
                    .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY)),
            ).toEqual(beforeSettings)
            expect(await audits()).toMatchObject([
                {
                    actorUserId: actorId,
                    action: 'update',
                    resource: 'host-monitoring',
                    targetId: hostId,
                    result: 'success',
                    metadata: { enabled: true },
                },
            ])
            expect(await service().getPolicy({ proxyHostId: hostId })).toEqual(policy)
            for (const internal of [
                'leaseToken',
                'leaseExpiresAt',
                'contextProof',
                'contextRevision',
                'configuredBy',
                'failureCount',
                'recoveryCount',
            ])
                expect(policy).not.toHaveProperty(internal)
            expect(policy.settings).toEqual(settings())
        },
    )

    integrationTest(
        'history is host-scoped, bounded, ordered and cursor-paginated under VIEW permission',
        async () => {
            const policy = await service().savePolicy(input())
            const when = new Date(Date.now() - 60_000)
            const observationIds = Array.from({ length: 5 }, () => randomUUID()).toSorted()
            await db.insert(hostCheckObservations).values(
                observationIds.map((id) => ({
                    id,
                    policyId: policy.id,
                    policyVersion: policy.version,
                    checkedAt: when,
                    status: 'healthy' as const,
                    code: 'expected_status' as const,
                    durationMs: 2,
                    httpStatus: 200,
                })),
            )
            await db.insert(hostCheckIncidents).values(
                Array.from({ length: 3 }, (_, offset) => ({
                    policyId: policy.id,
                    startedAt: new Date(when.getTime() + offset),
                    detectedAt: new Date(when.getTime() + offset),
                    failureCode: 'upstream_timeout' as const,
                    closedReason: 'policy_changed' as const,
                    closedAt: new Date(when.getTime() + 1000),
                })),
            )
            await grant([PERMISSIONS.PROXY_HOSTS_VIEW])
            const first = await service().getHistory({ proxyHostId: hostId, limit: 2 })
            expect(first.observations.map((row) => row.id)).toEqual(
                observationIds.toReversed().slice(0, 2),
            )
            expect(first.incidents).toHaveLength(2)
            expect(first.nextCursor).toEqual({
                checkedAt: when.toISOString(),
                id: observationIds[3]!,
            })
            const second = await service().getHistory({
                proxyHostId: hostId,
                limit: 2,
                before: first.nextCursor,
            })
            expect(second.observations.map((row) => row.id)).toEqual(
                observationIds.toReversed().slice(2, 4),
            )
            const last = await service().getHistory({
                proxyHostId: hostId,
                limit: 2,
                before: second.nextCursor,
            })
            expect(last.observations.map((row) => row.id)).toEqual([observationIds[0]!])
            expect(last.nextCursor).toBeNull()
            await expect(
                service().getHistory({ proxyHostId: hostId, limit: 101 }),
            ).rejects.toMatchObject({ code: 'invalid_input' })
            await grant([])
            await expect(
                service().getHistory({ proxyHostId: hostId, limit: 2 }),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(
                        and(
                            eq(hostCheckObservations.policyId, policy.id),
                            eq(hostCheckObservations.policyVersion, policy.version),
                        ),
                    ),
            ).toHaveLength(5)
        },
    )
})
