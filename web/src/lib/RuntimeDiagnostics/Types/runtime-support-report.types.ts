export type SupportReportSection<T> =
    | { readonly state: 'available'; readonly data: T }
    | { readonly state: 'unavailable'; readonly data: null }

export type SupportVersion =
    | { readonly state: 'available'; readonly value: string }
    | { readonly state: 'unavailable'; readonly value: null }

export interface SupportHostCounts {
    readonly total: number
    readonly enabled: number
}

export interface SupportCertificateCounts {
    readonly total: number
    readonly storedStatuses: Readonly<Record<string, number>>
    readonly operations: Readonly<Record<string, number>>
    readonly operationStages: Readonly<Record<string, number>>
    readonly errors: Readonly<Record<string, number>>
}

export interface SupportJobCounts {
    readonly total: number
    readonly stages: Readonly<Record<string, number>>
    readonly controllerStages: Readonly<Record<string, number>>
    readonly errors: Readonly<Record<string, number>>
}

export interface RuntimeSupportReport {
    readonly format: 'rentnerproxy-runtime-support'
    readonly formatVersion: 1
    readonly capturedAt: string
    readonly completeness: 'complete' | 'partial'
    readonly versions: {
        readonly application: SupportVersion
        readonly controller: SupportVersion
        readonly caddy: SupportVersion & { readonly source: 'configured_binary' }
    }
    readonly components: {
        readonly controller: 'connected' | 'unavailable'
        readonly database: 'connected' | 'unavailable'
        readonly valkey: 'connected' | 'unavailable'
        readonly caddy: { readonly available: boolean | null; readonly running: boolean | null }
    }
    readonly runtime: {
        readonly state: 'synced' | 'pending' | 'unavailable'
        readonly desiredRevision: string | null
        readonly appliedRevision: string | null
        readonly lastApplyAt: string | null
    }
    readonly configuration: SupportReportSection<{
        readonly proxyHosts: SupportHostCounts
        readonly redirectHosts: SupportHostCounts
    }>
    readonly certificates: SupportReportSection<SupportCertificateCounts>
    readonly certificateJobs: SupportReportSection<SupportJobCounts>
    readonly unavailableSections: readonly string[]
}

export interface RuntimeSupportReportInput {
    readonly applicationVersion: unknown
    readonly controllerHealth: unknown
    readonly caddyVersion: unknown
    readonly databaseHealth: unknown
    readonly valkeyHealth: unknown
    readonly desiredRevision: unknown
    readonly runtimeStatus: unknown
    readonly configuration: unknown
    readonly certificates: unknown
    readonly certificateJobs: unknown
}
