import {
    classifyHostMonitoringOutcome,
    unknownHostMonitoringOutcome,
} from '@/lib/HostMonitoring/state.ts'
import { domainDiagnosticsResultSchema } from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import {
    DomainDiagnosticsError,
    assertDiagnosticsNotAborted,
} from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import type { HostMonitoringClaim } from './Types/host-monitoring.repository.types.ts'
import type { HostMonitoringProbeDependencies } from './Types/host-monitoring-probe.types.ts'
import type { HostMonitoringOutcome } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'

export function createHostMonitoringProbe(dependencies: HostMonitoringProbeDependencies) {
    return async (claim: HostMonitoringClaim, signal: AbortSignal): Promise<void> => {
        try {
            assertDiagnosticsNotAborted(signal)
            const context = await dependencies.readContext(claim)
            assertDiagnosticsNotAborted(signal)
            if (!context?.enabled) return
            const { policy } = claim
            let outcome: HostMonitoringOutcome
            try {
                const result = await dependencies.inspect(
                    {
                        hostType: 'proxy',
                        hostId: policy.proxyHostId,
                        domain: policy.domain,
                        expectedRevision: context.revision,
                    },
                    signal,
                    { upstreamOnly: true, timeoutMs: policy.timeoutMs },
                )
                assertDiagnosticsNotAborted(signal)
                const parsed = domainDiagnosticsResultSchema.safeParse(result)
                outcome =
                    !parsed.success ||
                    parsed.data.hostType !== 'proxy' ||
                    parsed.data.hostId !== policy.proxyHostId ||
                    parsed.data.domain !== policy.domain ||
                    parsed.data.expectedRevision !== context.revision
                        ? unknownHostMonitoringOutcome('invalid_response')
                        : classifyHostMonitoringOutcome(parsed.data, policy.expectedStatus)
            } catch (error) {
                assertDiagnosticsNotAborted(signal)
                outcome = unknownHostMonitoringOutcome(
                    error instanceof DomainDiagnosticsError && error.code === 'busy'
                        ? 'busy'
                        : 'runtime_unavailable',
                )
            }
            assertDiagnosticsNotAborted(signal)
            await dependencies.complete(claim, outcome, context)
        } finally {
            // Fenced release is harmless after a successful completion, and also
            // covers cancellation, vanished hosts and preflight storage errors.
            await dependencies.release(claim)
        }
    }
}
