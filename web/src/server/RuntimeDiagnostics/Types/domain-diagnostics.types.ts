import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type {
    DomainDiagnosticsInput,
    DomainDiagnosticsControllerInput,
    DomainDiagnosticsResult,
} from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
export interface DomainDiagnosticsContext {
    readonly enabled: boolean
    readonly proof: string
    readonly revision: string
}
export interface DomainDiagnosticsDependencies {
    readonly requireActor: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly rateLimit: (actorId: string) => Promise<void>
    readonly readContext: (
        actorId: string,
        input: DomainDiagnosticsInput,
    ) => Promise<DomainDiagnosticsContext>
    readonly inspect: (
        input: DomainDiagnosticsControllerInput,
        signal?: AbortSignal,
    ) => Promise<DomainDiagnosticsResult>
    readonly now: () => Date
}
