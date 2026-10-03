export interface LogEntry {
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

export interface LogPage {
    readonly entries: LogEntry[]
    readonly limit: number
    readonly offset: number
    readonly total: number
    readonly hasMore: boolean
    readonly truncated: boolean
    readonly snapshot: string
    readonly snapshotExpiresAt: string
    readonly snapshotReset: boolean
}

export interface SmokeOptions {
    readonly controllerUrl: string
    readonly httpUrl: string
    readonly runtimeContainer: string
    readonly controllerRequest: (path: string) => Promise<Response>
    readonly command: (args: string[]) => Promise<string>
    readonly restart: () => Promise<void>
    readonly waitFor: (check: () => Promise<boolean>, label: string) => Promise<void>
}
