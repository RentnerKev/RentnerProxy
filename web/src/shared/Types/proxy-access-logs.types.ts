export interface ProxyAccessLogEntry {
    readonly timestamp: string
    readonly host: string
    readonly method: string
    readonly path: string
    readonly status: number
    readonly durationMs: number
    readonly clientIp: string
    readonly upstream: string | null
    readonly bytes: number
    readonly protocol: string
}

export interface ProxyAccessLogsQuery {
    readonly host?: string | undefined
    readonly status?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
    readonly offset?: number | undefined
    readonly snapshot?: string | undefined
}

export interface ProxyAccessLogsResult {
    readonly entries: readonly ProxyAccessLogEntry[]
    readonly limit: number
    readonly offset: number
    readonly total: number
    readonly hasMore: boolean
    readonly truncated: boolean
    readonly snapshot: string
    readonly snapshotExpiresAt: string
    readonly snapshotReset: boolean
}
