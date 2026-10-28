import type { HostMonitoringClaim } from './host-monitoring.repository.types.ts'
import type { DomainDiagnosticsContext } from '@/server/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import type {
    DomainDiagnosticsControllerInput,
    DomainDiagnosticsResult,
} from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import type { HostMonitoringOutcome } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import type { DomainDiagnosticsProbeOptions } from '@/server/Controller/Types/domain-diagnostics.types.ts'

export interface HostMonitoringProbeDependencies {
    readonly readContext: (claim: HostMonitoringClaim) => Promise<DomainDiagnosticsContext | null>
    readonly inspect: (
        input: DomainDiagnosticsControllerInput,
        signal: AbortSignal,
        options: DomainDiagnosticsProbeOptions,
    ) => Promise<DomainDiagnosticsResult>
    readonly complete: (
        claim: HostMonitoringClaim,
        outcome: HostMonitoringOutcome,
        context: DomainDiagnosticsContext,
    ) => Promise<boolean>
    readonly release: (claim: HostMonitoringClaim) => Promise<unknown>
}
