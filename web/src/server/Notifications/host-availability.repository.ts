// oxlint-disable-next-line import/no-unassigned-import -- Host incident admission is a privileged transaction boundary.
import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { hostCheckPolicies, hostDomains, proxyHosts } from '@/db/schema.ts'
import type { HostMonitoringContext } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { HostMonitoringPolicy } from '@/server/HostMonitoring/Types/host-monitoring.repository.types.ts'
import { readHostMonitoringContextInTransaction } from '@/server/RuntimeDiagnostics/domain-diagnostics-data.ts'
import { DomainDiagnosticsError } from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import {
    cancelHostAvailabilityIncidents,
    observeHostAvailabilityTransition,
} from './host-availability.ts'
import { resolveEffectiveNotificationConfigurationInTransaction } from './notification-access.ts'
import {
    lockNotificationConfiguration,
    lockNotificationRuntime,
    readNotificationConfiguration,
    readNotificationRuntime,
    writeNotificationRuntime,
} from './notification-storage.ts'
import type {
    HostAvailabilityIncidentSource,
    NotificationDeliveryClaim,
} from './Types/notification-internal.types.ts'
import type { NotificationState } from './Types/notification-state.types.ts'

export async function cancelHostAvailabilityForHostsInTransaction(
    transaction: AuthTransaction,
    proxyHostIds: readonly string[],
): Promise<void> {
    const ids = new Set(proxyHostIds)
    if (ids.size === 0) return
    const snapshot = await readNotificationRuntime(transaction)
    if (
        !snapshot.engine.incidents.some((incident) => incident.host && ids.has(incident.resourceId))
    )
        return
    await lockNotificationConfiguration(transaction)
    const runtime = await lockNotificationRuntime(transaction)
    const invalid = new Set(
        runtime.engine.incidents
            .filter((incident) => incident.host && ids.has(incident.resourceId))
            .map((incident) => incident.id),
    )
    const engine = cancelHostAvailabilityIncidents(runtime.engine, invalid, Date.now())
    if (engine !== runtime.engine)
        await writeNotificationRuntime(transaction, { ...runtime, engine })
}

export async function recordHostAvailabilityTransitionInTransaction(
    transaction: AuthTransaction,
    policy: HostMonitoringPolicy,
    context: HostMonitoringContext,
    incident: HostAvailabilityIncidentSource,
    kind: 'outage' | 'recovery',
): Promise<void> {
    const snapshot = await readNotificationConfiguration(transaction)
    if (
        kind === 'outage' &&
        (!snapshot.enabled ||
            snapshot.pausedAfterRestore ||
            !snapshot.channels.some(
                (channel) => channel.enabled && channel.events.includes('host_availability'),
            ))
    )
        return
    if (kind === 'recovery') {
        const previous = await readNotificationRuntime(transaction)
        if (!previous.engine.incidents.some((candidate) => candidate.id === incident.id)) return
    }
    // Monitoring already holds runtime settings and its own lock. Notification operations
    // only read monitoring data, preserving this configuration-before-runtime lock order.
    const configuration = await resolveEffectiveNotificationConfigurationInTransaction(
        transaction,
        await lockNotificationConfiguration(transaction),
    )
    const runtime = await lockNotificationRuntime(transaction)
    const occurredAt = kind === 'recovery' ? incident.recoveredAt : incident.detectedAt
    if (!occurredAt) return
    const engine = observeHostAvailabilityTransition(
        runtime.engine,
        configuration,
        {
            kind,
            incidentId: incident.id,
            proxyHostId: policy.proxyHostId,
            startedAt: incident.startedAt.getTime(),
            occurredAt: occurredAt.getTime(),
            failures: policy.failureThreshold,
            host: {
                policyId: policy.id,
                policyVersion: policy.version,
                contextProof: context.proof,
                contextRevision: context.revision,
                domain: policy.domain,
                failureCode: incident.failureCode,
                detectedAt: incident.detectedAt.toISOString(),
                recoveryStartedAt: incident.recoveryStartedAt?.toISOString() ?? null,
                managementPath: '/proxy-hosts',
            },
        },
        Math.max(Date.now(), occurredAt.getTime()),
        randomUUID,
    )
    if (engine !== runtime.engine)
        await writeNotificationRuntime(transaction, { ...runtime, engine })
}

export async function reconcileHostAvailabilityInTransaction(
    transaction: AuthTransaction,
    state: NotificationState,
    now: number,
): Promise<NotificationState> {
    const incidents = state.incidents.filter((incident) => incident.host)
    if (incidents.length === 0) return state
    const policies = await transaction
        .select({ policy: hostCheckPolicies })
        .from(hostCheckPolicies)
        .innerJoin(proxyHosts, eq(proxyHosts.id, hostCheckPolicies.proxyHostId))
        .innerJoin(
            hostDomains,
            and(
                eq(hostDomains.proxyHostId, proxyHosts.id),
                eq(hostDomains.domain, hostCheckPolicies.domain),
            ),
        )
        .where(
            and(
                inArray(hostCheckPolicies.id, [
                    ...new Set(incidents.map((incident) => incident.host!.policyId)),
                ]),
                eq(hostCheckPolicies.enabled, true),
                eq(proxyHosts.enabled, true),
            ),
        )
    const current = new Map(policies.map(({ policy }) => [policy.id, policy]))
    const invalid = new Set(
        incidents
            .filter((incident) => {
                const host = incident.host!
                const policy = current.get(host.policyId)
                return (
                    !policy ||
                    policy.proxyHostId !== incident.resourceId ||
                    policy.version !== host.policyVersion ||
                    policy.domain !== host.domain ||
                    policy.contextProof !== host.contextProof ||
                    policy.contextRevision !== host.contextRevision
                )
            })
            .map((incident) => incident.id),
    )
    return cancelHostAvailabilityIncidents(state, invalid, now)
}

export async function authorizeHostAvailabilityDeliveryInTransaction(
    transaction: AuthTransaction,
    claim: NotificationDeliveryClaim,
): Promise<boolean> {
    if (claim.payload.category !== 'host_availability' || claim.payload.type === 'test') return true
    const runtime = await readNotificationRuntime(transaction)
    const incident = runtime.engine.incidents.find(
        (candidate) =>
            candidate.id === claim.payload.incidentId &&
            candidate.resourceId === claim.payload.resourceId,
    )
    const host = incident?.host
    if (!host) return false
    const currentState = await reconcileHostAvailabilityInTransaction(
        transaction,
        runtime.engine,
        Date.now(),
    )
    if (!currentState.incidents.some((candidate) => candidate.id === incident.id)) return false
    try {
        const current = await readHostMonitoringContextInTransaction(transaction, {
            hostType: 'proxy',
            hostId: incident.resourceId,
            domain: host.domain,
        })
        return (
            current.enabled &&
            current.availability.proof === host.contextProof &&
            current.availability.revision === host.contextRevision
        )
    } catch (error) {
        if (error instanceof DomainDiagnosticsError && error.code === 'invalid_input') return false
        throw error
    }
}
