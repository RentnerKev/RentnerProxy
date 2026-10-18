import type { NotificationObservation } from '@/lib/Notifications/Types/notifications.types.ts'
import type { CertificateEventMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import type { DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'
import type { ProxyRuntimeStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

function time(value: string | null | undefined): number | null {
    if (!value) return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
}

function activatedAt(certificate: ControllerCertificateMetadata, nowMs: number): string | null {
    const activated = time(certificate.lastActivatedAt)
    const failed = time(certificate.lastErrorAt)
    if (
        certificate.source !== 'acme' ||
        certificate.status !== 'valid' ||
        !certificate.fingerprint ||
        certificate.candidate ||
        certificate.operation !== 'idle' ||
        activated === null ||
        activated > nowMs ||
        (certificate.lastErrorCode !== null && failed === null) ||
        (failed !== null && activated <= failed) ||
        (time(certificate.expiresAt) ?? 0) <= nowMs
    )
        return null
    return new Date(activated).toISOString()
}

export function certificateEventObservations(
    events: readonly CertificateEventMetadata[],
    certificates: readonly ControllerCertificateMetadata[],
    nowMs: number,
): NotificationObservation[] {
    const byId = new Map(certificates.map((certificate) => [certificate.id, certificate]))
    const observations: NotificationObservation[] = []
    for (const event of events) {
        const certificate = byId.get(event.certificateId)
        if (
            !certificate ||
            certificate.source !== 'acme' ||
            (time(event.occurredAt) ?? Infinity) > nowMs
        )
            continue
        const operationKind =
            event.operationKind ??
            (certificate.currentOperation?.id === event.operationId
                ? certificate.currentOperation.kind
                : null)
        if (operationKind !== 'renew') continue
        const failing =
            (event.kind === 'failed' || event.kind === 'retry_scheduled') &&
            event.errorCode !== null
        const activation = activatedAt(certificate, nowMs)
        const recovered =
            (event.kind === 'renewed' || event.kind === 'activated') &&
            event.stage === 'applied' &&
            activation !== null &&
            Date.parse(activation) >= Date.parse(event.occurredAt)
        if (!failing && !recovered) continue
        observations.push({
            source: 'event',
            category: 'certificate_renewal',
            resourceId: event.certificateId,
            health: failing ? 'failing' : 'healthy',
            severity: event.stage === 'needs_attention' ? 'critical' : 'error',
            occurredAt: failing ? new Date(event.occurredAt).toISOString() : activation!,
            evidence: failing
                ? JSON.stringify([
                      'certificate-renewal',
                      event.operationId,
                      new Date(event.occurredAt).toISOString(),
                      event.errorCode,
                  ])
                : JSON.stringify(['certificate-activation', activation]),
            failures: failing
                ? certificate.currentOperation?.id === event.operationId &&
                  time(certificate.lastErrorAt) === time(event.occurredAt)
                    ? Math.max(1, certificate.attemptCount ?? 1)
                    : 1
                : 0,
        })
    }
    return observations
}

export function certificateSnapshotObservations(
    certificates: readonly ControllerCertificateMetadata[],
    nowMs: number,
): NotificationObservation[] {
    const observations: NotificationObservation[] = []
    for (const certificate of certificates) {
        if (certificate.source !== 'acme') continue
        const operation = certificate.currentOperation
        const renewing =
            operation?.kind === 'renew' || (!operation && certificate.operation === 'renewing')
        if (renewing && certificate.lastErrorCode !== null) {
            const at = certificate.lastErrorAt ?? certificate.lastAttemptAt ?? operation?.updatedAt
            const occurred = time(at)
            if (at && occurred !== null && occurred <= nowMs)
                observations.push({
                    source: 'snapshot',
                    category: 'certificate_renewal',
                    resourceId: certificate.id,
                    health: 'failing',
                    severity: operation?.stage === 'needs_attention' ? 'critical' : 'error',
                    occurredAt: new Date(occurred).toISOString(),
                    evidence: JSON.stringify([
                        'certificate-renewal',
                        operation?.id ?? null,
                        new Date(occurred).toISOString(),
                        certificate.lastErrorCode,
                    ]),
                    failures: Math.max(1, certificate.attemptCount ?? 1),
                })
        }
        const activation = activatedAt(certificate, nowMs)
        if (activation)
            observations.push({
                source: 'snapshot',
                category: 'certificate_renewal',
                resourceId: certificate.id,
                health: 'healthy',
                severity: 'error',
                occurredAt: activation,
                evidence: JSON.stringify(['certificate-activation', activation]),
                failures: 0,
            })
    }
    return observations
}

export function ddnsObservations(snapshot: DdnsSnapshot, nowMs: number): NotificationObservation[] {
    const configuration = snapshot.configuration
    if (!configuration?.settings.enabled || snapshot.restorePaused) return []
    const enabled = new Set(
        configuration.settings.targets
            .filter((target) => target.enabled)
            .map((target) => target.id),
    )
    const observations: NotificationObservation[] = []
    for (const target of snapshot.targets) {
        if (!enabled.has(target.targetId)) continue
        const failed =
            target.permanentFailure ||
            target.consecutiveFailures > 0 ||
            target.lastResult?.status === 'failed'
        const success =
            !failed &&
            (target.lastResult?.status === 'updated' ||
                target.lastResult?.status === 'unchanged') &&
            target.lastSuccessAt !== null &&
            target.lastAttemptAt !== null &&
            target.lastSuccessAt >= target.lastAttemptAt
        const at = failed ? target.lastAttemptAt : success ? target.lastSuccessAt : null
        if (at === null || at * 1_000 > nowMs) continue
        observations.push({
            source: 'snapshot',
            category: 'ddns',
            resourceId: target.targetId,
            health: failed ? 'failing' : 'healthy',
            severity: target.permanentFailure ? 'critical' : 'error',
            occurredAt: new Date(at * 1_000).toISOString(),
            evidence: JSON.stringify([
                'ddns',
                configuration.revision,
                target.connectionRevision,
                at,
                target.lastResult?.status ?? null,
                target.consecutiveFailures,
                target.permanentFailure,
            ]),
            failures: failed ? Math.max(1, target.consecutiveFailures) : 0,
        })
    }
    return observations
}

export function proxyConfigurationObservation(
    beforeRevision: string,
    runtime: ProxyRuntimeStatus | null,
    afterRevision: string,
    nowMs: number,
): NotificationObservation[] {
    if (beforeRevision !== afterRevision || runtime === null) return []
    const healthy =
        runtime?.available === true && runtime.running && runtime.activeRevision === beforeRevision
    return [
        {
            source: 'snapshot',
            category: 'proxy_configuration',
            resourceId: 'instance',
            health: healthy ? 'healthy' : 'pending',
            desiredRevision: beforeRevision,
            severity: 'error',
            occurredAt: new Date(nowMs).toISOString(),
            evidence: JSON.stringify([
                'proxy',
                beforeRevision,
                runtime?.activeRevision ?? null,
                runtime?.available ?? false,
                runtime?.running ?? false,
            ]),
            failures: healthy ? 0 : 1,
        },
    ]
}
