import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import { NOTIFICATION_SETTINGS_KEY, NOTIFICATION_STATE_KEY } from '@/config/notifications.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
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
    users,
    userRoles,
} from '@/db/schema.ts'
import type { UpdateProxyHostInput } from '@/features/Admin/ProxyHostManagement/Types/validation.types.ts'
import type { HostMonitoringOutcome } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'
import { readHostTags, writeHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { updateProxyHostInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.mutations.server.ts'
import { ensureAuthorizationRegistryInTransaction } from '@/server/Auth/Access/registry.service.ts'
import {
    claimDueHostMonitoringPolicy,
    completeHostMonitoringClaim,
    pruneHostMonitoringHistory,
    saveHostMonitoringPolicy,
} from '@/server/HostMonitoring/host-monitoring.repository.ts'
import type { HostMonitoringPolicy } from '@/server/HostMonitoring/Types/host-monitoring.repository.types.ts'
import {
    acknowledgeNotificationDelivery,
    authorizeNotificationDelivery,
    claimNextNotificationDelivery,
} from '@/server/Notifications/notification-repository.ts'
import {
    lockNotificationConfiguration,
    lockNotificationRuntime,
    readNotificationRuntime,
    writeNotificationConfiguration,
    writeNotificationRuntime,
} from '@/server/Notifications/notification-storage.ts'
import type { StoredNotificationConfiguration } from '@/server/Notifications/Types/notification-internal.types.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { readHostMonitoringContextInTransaction } from '@/server/RuntimeDiagnostics/domain-diagnostics-data.ts'

const databaseUrl = getDatabaseUrl()
const isolated =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' &&
    databaseUrl !== null &&
    new URL(databaseUrl).hostname === '127.0.0.1' &&
    new URL(databaseUrl).pathname === '/rentnerproxy_upstream_test'
const integrationTest = isolated ? test : test.skip
const notificationKeys = [NOTIFICATION_SETTINGS_KEY, NOTIFICATION_STATE_KEY]
const hostIds: string[] = []
let actorId: string | undefined
let roleId: string | undefined

const unhealthy: HostMonitoringOutcome = {
    status: 'unhealthy',
    code: 'upstream_timeout',
    durationMs: 3_000,
    httpStatus: null,
}
const healthy: HostMonitoringOutcome = {
    status: 'healthy',
    code: 'expected_status',
    durationMs: 4,
    httpStatus: 200,
}

function configuration(): StoredNotificationConfiguration {
    return {
        version: 1,
        revision: 1,
        enabled: true,
        pausedAfterRestore: false,
        channels: [
            {
                id: '00000000-0000-4000-8000-000000000289',
                name: 'Host availability fixture',
                kind: 'webhook',
                revision: 1,
                enabled: true,
                events: ['host_availability'],
                minimumSeverity: 'error',
                thresholdSeconds: 0,
                recovery: true,
                // Repository tests neither decrypt nor send this shape-valid sealed destination.
                destination: { ciphertext: 'a'.repeat(32), iv: 'b'.repeat(16) },
                hasAuthorization: false,
            },
        ],
    }
}

async function fixture(): Promise<HostMonitoringPolicy> {
    if (!actorId) throw new Error('Host availability fixture actor is unavailable.')
    const id = randomUUID()
    hostIds.push(id)
    const domain = `availability-${id}.example.test`
    await db.insert(proxyHosts).values({
        id,
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
    })
    await db.insert(hostDomains).values({ proxyHostId: id, domain })
    return db.transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        return saveHostMonitoringPolicy(transaction, {
            proxyHostId: id,
            configuredBy: actorId!,
            existing: null,
            settings: {
                ...HOST_MONITORING_DEFAULTS,
                enabled: true,
                domain,
                failureThreshold: 1,
                recoveryThreshold: 1,
            },
        })
    })
}

async function claim(policy: HostMonitoringPolicy) {
    await db
        .update(hostCheckPolicies)
        .set({ nextCheckAt: new Date(0) })
        .where(eq(hostCheckPolicies.id, policy.id))
    const claimed = await claimDueHostMonitoringPolicy()
    if (!claimed || claimed.policy.id !== policy.id)
        throw new Error('Owned host availability policy was not claimed.')
    return claimed
}

async function context(policy: HostMonitoringPolicy) {
    return db.transaction(
        async (transaction) => {
            const current = await readHostMonitoringContextInTransaction(transaction, {
                hostType: 'proxy',
                hostId: policy.proxyHostId,
                domain: policy.domain,
            })
            return current.availability
        },
        { accessMode: 'read only' },
    )
}

async function finish(policy: HostMonitoringPolicy, outcome: HostMonitoringOutcome) {
    const current = await context(policy)
    return completeHostMonitoringClaim(await claim(policy), outcome, async () => true, current)
}

function readRuntime() {
    return db.transaction(readNotificationRuntime, { accessMode: 'read only' })
}

async function editHost(policy: HostMonitoringPolicy, changes: Partial<UpdateProxyHostInput>) {
    if (!actorId) throw new Error('Host availability fixture actor is unavailable.')
    return db.transaction((transaction) =>
        updateProxyHostInTransaction(transaction, actorId!, {
            proxyHostId: policy.proxyHostId,
            domains: [policy.domain],
            enabled: true,
            forwardScheme: 'http',
            forwardHost: '127.0.0.1',
            forwardPort: 8080,
            ...changes,
        }),
    )
}

async function policyRow(policy: HostMonitoringPolicy) {
    const [row] = await db
        .select()
        .from(hostCheckPolicies)
        .where(eq(hostCheckPolicies.id, policy.id))
    return row
}

describe('host availability notification PostgreSQL bridge', () => {
    beforeAll(async () => {
        if (isolated) await db.transaction(ensureAuthorizationRegistryInTransaction)
    })
    beforeEach(async () => {
        if (!isolated) return
        const [existing] = await db
            .select({ count: sql<number>`count(*)::integer` })
            .from(hostCheckPolicies)
        expect(existing?.count).toBe(0)
        await db.delete(systemSettings).where(inArray(systemSettings.key, notificationKeys))
        actorId = randomUUID()
        await db.insert(users).values({
            id: actorId,
            displayName: 'Availability fixture',
            email: `${actorId}@availability-fixture.invalid`,
            status: 'active',
        })
        roleId = randomUUID()
        await db
            .insert(roles)
            .values({ id: roleId, key: `availability-${roleId}`, name: 'Availability fixture' })
        const selected = await db
            .select({ id: permissions.id })
            .from(permissions)
            .where(
                inArray(permissions.key, [
                    PERMISSIONS.PROXY_HOSTS_VIEW,
                    PERMISSIONS.PROXY_HOSTS_UPDATE,
                    PERMISSIONS.PROXY_HOSTS_ENABLE,
                    PERMISSIONS.PROXY_HOSTS_DISABLE,
                ]),
            )
        expect(selected).toHaveLength(4)
        await db
            .insert(rolePermissions)
            .values(
                selected.map((permission) => ({ roleId: roleId!, permissionId: permission.id })),
            )
        await db.insert(userRoles).values({ userId: actorId, roleId })
        await db.transaction(async (transaction) => {
            await lockNotificationConfiguration(transaction)
            await writeNotificationConfiguration(transaction, configuration())
            const runtime = await lockNotificationRuntime(transaction)
            await writeNotificationRuntime(transaction, runtime)
        })
    })

    afterEach(async () => {
        if (!isolated) return
        if (hostIds.length)
            await db.delete(proxyHosts).where(inArray(proxyHosts.id, hostIds.splice(0)))
        if (actorId) {
            await db.delete(auditEvents).where(eq(auditEvents.actorUserId, actorId))
            await db.delete(users).where(eq(users.id, actorId))
        }
        if (roleId) await db.delete(roles).where(eq(roles.id, roleId))
        roleId = undefined
        actorId = undefined
        await db.delete(systemSettings).where(inArray(systemSettings.key, notificationKeys))
    })

    integrationTest(
        'completion persists the source identity and one notification through repeated JSON reloads',
        async () => {
            const policy = await fixture()
            expect(await finish(policy, unhealthy)).toBe(true)
            const [source] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(source).toBeDefined()
            const first = await readRuntime()
            expect(first.engine.incidents).toHaveLength(1)
            expect(first.engine.incidents[0]).toMatchObject({
                id: source!.id,
                category: 'host_availability',
                resourceId: policy.proxyHostId,
                recoveredAt: null,
            })
            expect(first.engine.deliveries).toHaveLength(1)
            expect(await finish(policy, unhealthy)).toBe(true)
            const reloaded = await readRuntime()
            expect(reloaded.engine).toEqual(first.engine)
            const [stored] = await db
                .select({ value: systemSettings.value })
                .from(systemSettings)
                .where(eq(systemSettings.key, NOTIFICATION_STATE_KEY))
            expect(stored?.value).toEqual(JSON.parse(JSON.stringify(reloaded)))
            const delivery = await claimNextNotificationDelivery()
            expect(delivery).not.toBeNull()
            expect(await authorizeNotificationDelivery(delivery!)).not.toBeNull()
        },
    )

    integrationTest(
        'outage and recovery with the sender stopped survive reload and deliver exactly one ordered pair',
        async () => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            const outage = (await readRuntime()).engine.incidents[0]!
            await finish(policy, healthy)
            await finish(policy, healthy)
            const stopped = await readRuntime()
            expect(stopped.engine.incidents).toHaveLength(1)
            expect(stopped.engine.incidents[0]?.id).toBe(outage.id)
            expect(stopped.engine.incidents[0]?.recoveredAt).not.toBeNull()
            expect(stopped.engine.deliveries.map((delivery) => delivery.payload.type)).toEqual([
                'incident',
            ])
            const failure = await claimNextNotificationDelivery()
            expect(failure?.payload.type).toBe('incident')
            expect(await claimNextNotificationDelivery()).toBeNull()
            await acknowledgeNotificationDelivery(failure!.leaseToken, { success: true })
            const recovery = await claimNextNotificationDelivery()
            expect(recovery?.payload.type).toBe('recovery')
            expect(recovery?.payload.incidentId).toBe(outage.id)
            expect(await authorizeNotificationDelivery(recovery!)).not.toBeNull()
            await acknowledgeNotificationDelivery(recovery!.leaseToken, { success: true })
            expect(await claimNextNotificationDelivery()).toBeNull()
            expect(
                (await readRuntime()).engine.deliveries.map((delivery) => ({
                    type: delivery.payload.type,
                    status: delivery.status,
                })),
            ).toEqual([
                { type: 'incident', status: 'succeeded' },
                { type: 'recovery', status: 'succeeded' },
            ])
        },
    )

    integrationTest(
        'source history retention leaves the notification outbox and recovery obligation intact',
        async () => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            await finish(policy, healthy)
            const before = await readRuntime()
            await db
                .update(hostCheckIncidents)
                .set({
                    startedAt: new Date(0),
                    detectedAt: new Date(0),
                    recoveryStartedAt: new Date(1),
                    recoveredAt: new Date(1),
                    closedAt: new Date(1),
                })
                .where(eq(hostCheckIncidents.policyId, policy.id))
            await db
                .update(hostCheckObservations)
                .set({ checkedAt: new Date(0) })
                .where(eq(hostCheckObservations.policyId, policy.id))
            await pruneHostMonitoringHistory()
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(0)
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, policy.id)),
            ).toHaveLength(0)
            expect(await readRuntime()).toEqual(before)
            const failure = await claimNextNotificationDelivery()
            expect(failure?.payload.type).toBe('incident')
            await acknowledgeNotificationDelivery(failure!.leaseToken, { success: true })
            expect((await claimNextNotificationDelivery())?.payload.type).toBe('recovery')
        },
    )

    integrationTest.each([
        'disabled host',
        'deleted host',
        'disabled policy',
        'deleted policy',
    ] as const)('%s cancels queued work without inventing a recovery', async (change) => {
        const policy = await fixture()
        await finish(policy, unhealthy)
        if (change === 'disabled host')
            await db
                .update(proxyHosts)
                .set({ enabled: false })
                .where(eq(proxyHosts.id, policy.proxyHostId))
        else if (change === 'deleted host')
            await db.delete(proxyHosts).where(eq(proxyHosts.id, policy.proxyHostId))
        else if (change === 'disabled policy')
            await db
                .update(hostCheckPolicies)
                .set({ enabled: false })
                .where(eq(hostCheckPolicies.id, policy.id))
        else await db.delete(hostCheckPolicies).where(eq(hostCheckPolicies.id, policy.id))
        expect(await claimNextNotificationDelivery()).toBeNull()
        const runtime = await readRuntime()
        expect(runtime.engine.incidents).toHaveLength(0)
        expect(runtime.engine.deliveries).toHaveLength(1)
        expect(runtime.engine.deliveries[0]).toMatchObject({
            status: 'cancelled',
            payload: { type: 'incident' },
        })
    })

    integrationTest.each([
        ['disable and enable', false],
        ['disable and enable', true],
        ['upstream A to B to A', false],
        ['upstream A to B to A', true],
        ['domain A to B to A', false],
        ['domain A to B to A', true],
    ] as const)(
        '%s permanently cancels the old notification before polling resumes (outage delivered: %p)',
        async (change, delivered) => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            if (delivered) {
                const failure = await claimNextNotificationDelivery()
                expect(failure?.payload.type).toBe('incident')
                await acknowledgeNotificationDelivery(failure!.leaseToken, { success: true })
                await finish(policy, healthy)
            }
            const previous = await readRuntime()
            expect(previous.engine.incidents).toHaveLength(1)
            if (change === 'disable and enable') await editHost(policy, { enabled: false })
            else if (change === 'upstream A to B to A')
                await editHost(policy, { forwardHost: '127.0.0.2' })
            else
                await editHost(policy, {
                    domains: [`alternate-${policy.proxyHostId}.example.test`],
                })
            // Restore exactly the original context before the notification worker can reconcile it.
            await editHost(policy, {})
            const cancelled = await readRuntime()
            expect(cancelled.engine.incidents).toHaveLength(0)
            expect(
                cancelled.engine.deliveries.every(
                    (delivery) =>
                        delivery.status === 'cancelled' || delivery.status === 'succeeded',
                ),
            ).toBe(true)
            expect(await claimNextNotificationDelivery()).toBeNull()
            expect(await finish(policy, healthy)).toBe(true)
            expect(await claimNextNotificationDelivery()).toBeNull()
            const final = await readRuntime()
            expect(final.engine.incidents).toHaveLength(0)
            expect(final.engine.deliveries).toEqual(cancelled.engine.deliveries)
        },
    )

    integrationTest.each([
        'disable and enable',
        'upstream A to B to A',
        'domain A to B to A',
    ] as const)(
        '%s resets monitoring continuity so the next confirmed outage creates a fresh alert',
        async (change) => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            const previous = await readRuntime()
            const oldIncident = previous.engine.incidents[0]!
            const before = await policyRow(policy)
            if (change === 'disable and enable') await editHost(policy, { enabled: false })
            else if (change === 'upstream A to B to A')
                await editHost(policy, { forwardHost: '127.0.0.2' })
            else
                await editHost(policy, {
                    domains: [`alternate-${policy.proxyHostId}.example.test`],
                })
            await editHost(policy, {})
            const reset = await policyRow(policy)
            expect(reset?.version).not.toBe(before?.version)
            expect(reset).toMatchObject({
                state: 'unknown',
                failureCount: 0,
                recoveryCount: 0,
                failureStartedAt: null,
                recoveryStartedAt: null,
                contextProof: null,
                contextRevision: null,
                leaseToken: null,
                leaseExpiresAt: null,
            })
            const [closed] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.id, oldIncident.id))
            expect(closed?.closedReason).toBe(
                change === 'disable and enable' ? 'monitoring_disabled' : 'policy_changed',
            )
            expect(closed?.recoveredAt).toBeNull()
            expect(await claimNextNotificationDelivery()).toBeNull()
            // No healthy probe is needed between the edit and the next real outage.
            expect(await finish(policy, unhealthy)).toBe(true)
            const refreshed = await readRuntime()
            expect(refreshed.engine.incidents).toHaveLength(1)
            const freshIncident = refreshed.engine.incidents[0]!
            expect(freshIncident.id).not.toBe(oldIncident.id)
            expect(freshIncident.host?.policyVersion).toBe(reset?.version)
            expect(freshIncident.recoveredAt).toBeNull()
            const sources = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(sources).toHaveLength(2)
            expect(
                sources.find((source) => source.id === freshIncident.id)?.closedReason,
            ).toBeNull()
            expect(
                refreshed.engine.deliveries.find(
                    (delivery) => delivery.payload.incidentId === oldIncident.id,
                )?.status,
            ).toBe('cancelled')
            const delivery = await claimNextNotificationDelivery()
            expect(delivery?.payload).toMatchObject({
                type: 'incident',
                incidentId: freshIncident.id,
            })
            expect(await authorizeNotificationDelivery(delivery!)).not.toBeNull()
        },
    )

    integrationTest(
        'tag assignment and display-name edits preserve the active host incident',
        async () => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            const before = await readRuntime()
            const tagId = randomUUID()
            const original = await db.transaction((transaction) =>
                readHostTags(transaction, 'proxy'),
            )
            try {
                await db.transaction(async (transaction) => {
                    await lockProxyRuntimeSettings(transaction)
                    await writeHostTags(transaction, 'proxy', {
                        ...original,
                        revision: original.revision + 1,
                        tags: [...original.tags, { id: tagId, name: 'Availability test' }],
                    })
                })
                const updated = await editHost(policy, { tagIds: [tagId] })
                expect(updated.tags?.map((tag) => tag.id)).toEqual([tagId])
                await db.transaction(async (transaction) => {
                    await lockProxyRuntimeSettings(transaction)
                    const tags = await readHostTags(transaction, 'proxy')
                    const fixtureTag = tags.tags.find((tag) => tag.id === tagId)
                    if (!fixtureTag) throw new Error('Owned availability fixture tag disappeared.')
                    fixtureTag.name = 'Renamed availability test'
                    await writeHostTags(transaction, 'proxy', {
                        ...tags,
                        revision: tags.revision + 1,
                    })
                })
                await editHost(policy, { tagIds: [tagId] })
                expect(await readRuntime()).toEqual(before)
                const delivery = await claimNextNotificationDelivery()
                expect(delivery?.payload.incidentId).toBe(before.engine.incidents[0]?.id)
                expect(await authorizeNotificationDelivery(delivery!)).not.toBeNull()
            } finally {
                await db.transaction(async (transaction) => {
                    await lockProxyRuntimeSettings(transaction)
                    await writeHostTags(transaction, 'proxy', original)
                })
            }
        },
    )

    integrationTest(
        'dispatch rechecks the actual upstream context after a delivery has been claimed',
        async () => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            const delivery = await claimNextNotificationDelivery()
            expect(delivery).not.toBeNull()
            expect(await authorizeNotificationDelivery(delivery!)).not.toBeNull()
            await db
                .update(proxyHosts)
                .set({ forwardPort: 8081 })
                .where(eq(proxyHosts.id, policy.proxyHostId))
            expect(await authorizeNotificationDelivery(delivery!)).toBeNull()
        },
    )

    integrationTest(
        'disabling notifications before recovery closes the existing incident silently',
        async () => {
            const policy = await fixture()
            await finish(policy, unhealthy)
            const failure = await claimNextNotificationDelivery()
            await acknowledgeNotificationDelivery(failure!.leaseToken, { success: true })
            await db.transaction(async (transaction) => {
                const previous = await lockNotificationConfiguration(transaction)
                await writeNotificationConfiguration(transaction, {
                    ...previous,
                    revision: previous.revision + 1,
                    enabled: false,
                })
            })
            expect(await finish(policy, healthy)).toBe(true)
            const [source] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(source?.closedReason).toBe('recovered')
            const runtime = await readRuntime()
            expect(runtime.engine.incidents[0]?.recoveredAt).not.toBeNull()
            expect(runtime.engine.deliveries).toHaveLength(1)
            expect(runtime.engine.deliveries[0]?.payload.type).toBe('incident')
            expect(await claimNextNotificationDelivery()).toBeNull()
        },
    )

    integrationTest(
        'an invalid notification runtime rolls back the observation, incident, and policy completion together',
        async () => {
            const policy = await fixture()
            const admitted = await claim(policy)
            const before = await policyRow(policy)
            const current = await context(policy)
            await db
                .update(systemSettings)
                .set({ value: sql`${{ version: 1, engine: {} }}` })
                .where(eq(systemSettings.key, NOTIFICATION_STATE_KEY))
            await expect(
                completeHostMonitoringClaim(admitted, unhealthy, async () => true, current),
            ).rejects.toMatchObject({ code: 'configuration_unavailable' })
            expect(await policyRow(policy)).toEqual(before)
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, policy.id)),
            ).toHaveLength(0)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(0)
        },
    )
})
