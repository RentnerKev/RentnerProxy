// oxlint-disable no-await-in-loop -- Journal cursor pages must be consumed in order, at most five pages per poll.
import type { NotificationObservation } from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    NotificationCollection,
    NotificationCollectorDependencies,
} from './Types/collector.types.ts'
import {
    certificateEventPageSchema,
    certificateMetadataSchema,
} from '@/server/Controller/certificates.validation.ts'
import {
    getControllerCertificates,
    getControllerCertificateEvents,
} from '@/server/Controller/certificates.server.ts'
import { ddnsController } from '@/server/Controller/ddns.server.ts'
import { getProxyRuntimeStatus } from '@/server/Controller/proxy.server.ts'
import {
    certificateEventObservations,
    certificateSnapshotObservations,
    ddnsObservations,
    proxyConfigurationObservation,
} from './observations.ts'

export function createNotificationCollector(dependencies: NotificationCollectorDependencies) {
    return async (
        certificateCursor: string | null,
        signal?: AbortSignal,
    ): Promise<NotificationCollection> => {
        const assertActive = () => signal?.throwIfAborted()
        assertActive()
        async function certificates(): Promise<NotificationCollection> {
            try {
                assertActive()
                const raw = await dependencies.certificates()
                assertActive()
                const snapshot = raw.map((certificate) =>
                    certificateMetadataSchema.parse(certificate),
                )
                const observations: NotificationObservation[] = []
                let cursor = certificateCursor
                for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
                    assertActive()
                    const page = certificateEventPageSchema.parse(
                        await dependencies.certificateEvents(cursor, 100),
                    )
                    assertActive()
                    if (page.events.length > 100 || (page.hasMore && page.nextCursor === cursor))
                        throw new Error('invalid_page')
                    observations.push(
                        ...certificateEventObservations(page.events, snapshot, dependencies.now()),
                    )
                    cursor = page.nextCursor
                    if (!page.hasMore) break
                }
                const eventFailures = new Set(
                    observations
                        .filter((item) => item.health === 'failing')
                        .map((item) => `${item.resourceId}:${item.occurredAt}`),
                )
                observations.push(
                    ...certificateSnapshotObservations(snapshot, dependencies.now()).filter(
                        (item) =>
                            item.health === 'healthy' ||
                            !eventFailures.has(`${item.resourceId}:${item.occurredAt}`),
                    ),
                )
                return { observations, certificateCursor: cursor }
            } catch {
                return { observations: [], certificateCursor }
            }
        }
        async function ddns(): Promise<readonly NotificationObservation[]> {
            try {
                assertActive()
                const snapshot = await dependencies.ddns()
                assertActive()
                return ddnsObservations(snapshot, dependencies.now())
            } catch {
                return []
            }
        }
        async function proxy(): Promise<readonly NotificationObservation[]> {
            try {
                assertActive()
                const before = await dependencies.proxySnapshot()
                assertActive()
                const runtime = await dependencies.proxyStatus()
                assertActive()
                const after = await dependencies.proxySnapshot()
                assertActive()
                return proxyConfigurationObservation(
                    before.revision,
                    runtime,
                    after.revision,
                    dependencies.now(),
                )
            } catch {
                return []
            }
        }
        const [certificateResult, ddnsResult, proxyResult] = await Promise.all([
            certificates(),
            ddns(),
            proxy(),
        ])
        assertActive()
        return {
            observations: [
                ...certificateResult.observations,
                ...ddnsResult,
                ...proxyResult,
            ].toSorted((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)),
            certificateCursor: certificateResult.certificateCursor,
        }
    }
}

export const collectNotificationObservations = createNotificationCollector({
    certificates: getControllerCertificates,
    certificateEvents: getControllerCertificateEvents,
    ddns: () => ddnsController.status(),
    proxySnapshot: async () =>
        (
            await import('@/server/ProxyRuntime/proxy-runtime.service.ts')
        ).getProxyRuntimeSnapshotService(),
    proxyStatus: getProxyRuntimeStatus,
    now: Date.now,
})
