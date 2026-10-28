import { domainDiagnosticsResultSchema } from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import type {
    HostMonitoringOutcome,
    HostMonitoringOutcomeCode,
    HostMonitoringStateChange,
    HostMonitoringStateSnapshot,
    HostMonitoringSettings,
} from './Types/host-monitoring.types.ts'

export function unknownHostMonitoringOutcome(
    code: HostMonitoringOutcomeCode,
): HostMonitoringOutcome {
    return { status: 'unknown', code, durationMs: null, httpStatus: null }
}

export function classifyHostMonitoringOutcome(
    raw: unknown,
    expectedStatus: number,
): HostMonitoringOutcome {
    const parsed = domainDiagnosticsResultSchema.safeParse(raw)
    if (
        !parsed.success ||
        !Number.isInteger(expectedStatus) ||
        expectedStatus < 100 ||
        expectedStatus > 599
    )
        return unknownHostMonitoringOutcome('invalid_response')
    const { configuration, upstream, tls } = parsed.data.stages
    if (configuration.code !== 'configuration_active') {
        switch (configuration.code) {
            case 'configuration_stale':
            case 'configuration_changed':
            case 'host_not_active':
            case 'runtime_unavailable':
                return unknownHostMonitoringOutcome(configuration.code)
            default:
                return unknownHostMonitoringOutcome('invalid_response')
        }
    }
    const durationMs = upstream.durationMs
    if (tls.code === 'tls_failed')
        return { status: 'unhealthy', code: 'tls_failed', durationMs, httpStatus: null }
    if (upstream.httpStatus !== null)
        return {
            status: upstream.httpStatus === expectedStatus ? 'healthy' : 'unhealthy',
            code: upstream.httpStatus === expectedStatus ? 'expected_status' : 'unexpected_status',
            durationMs,
            httpStatus: upstream.httpStatus,
        }
    if (
        upstream.code === 'upstream_unreachable' ||
        upstream.code === 'upstream_timeout' ||
        upstream.code === 'upstream_dns_failed'
    )
        return { status: 'unhealthy', code: upstream.code, durationMs, httpStatus: null }
    return unknownHostMonitoringOutcome('invalid_response')
}

export function advanceHostMonitoringState(
    previous: HostMonitoringStateSnapshot,
    outcome: HostMonitoringOutcome,
    settings: Pick<HostMonitoringSettings, 'failureThreshold' | 'recoveryThreshold'>,
    now: Date,
): HostMonitoringStateChange {
    const cleared = {
        failureCount: 0,
        recoveryCount: 0,
        failureStartedAt: null,
        recoveryStartedAt: null,
    }
    if (outcome.status === 'unknown')
        return { snapshot: { state: previous.state, ...cleared }, transition: null }
    if (outcome.status === 'healthy') {
        if (previous.state !== 'unhealthy')
            return { snapshot: { state: 'healthy', ...cleared }, transition: null }
        const count = Math.min(previous.recoveryCount + 1, settings.recoveryThreshold)
        const firstObservedAt = previous.recoveryStartedAt ?? now
        if (count < settings.recoveryThreshold)
            return {
                snapshot: {
                    state: 'unhealthy',
                    ...cleared,
                    recoveryCount: count,
                    recoveryStartedAt: firstObservedAt,
                },
                transition: null,
            }
        return {
            snapshot: { state: 'healthy', ...cleared },
            transition: { kind: 'recovery', firstObservedAt, confirmedAt: now, code: outcome.code },
        }
    }
    if (previous.state === 'unhealthy')
        return { snapshot: { state: 'unhealthy', ...cleared }, transition: null }
    const count = Math.min(previous.failureCount + 1, settings.failureThreshold)
    const firstObservedAt = previous.failureStartedAt ?? now
    if (count < settings.failureThreshold)
        return {
            snapshot: {
                state: previous.state,
                ...cleared,
                failureCount: count,
                failureStartedAt: firstObservedAt,
            },
            transition: null,
        }
    return {
        snapshot: { state: 'unhealthy', ...cleared },
        transition: { kind: 'outage', firstObservedAt, confirmedAt: now, code: outcome.code },
    }
}
