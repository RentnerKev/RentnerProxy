export type ImportStatus = 'ready' | 'partial' | 'manual' | 'conflict'

export type ImportKind =
    | 'proxy-host'
    | 'redirect-host'
    | 'access-policy'
    | 'certificate'
    | 'dead-host'
    | 'stream'

export interface ImportPreviewItem {
    readonly kind: ImportKind
    readonly sourceId: number
    readonly label: string
    readonly domains: readonly string[]
    readonly status: ImportStatus
    readonly reasons: readonly string[]
}

export interface ImportPreview {
    readonly fingerprint: string
    readonly planFingerprint: string
    readonly sourceSchema: string
    readonly items: readonly ImportPreviewItem[]
    readonly counts: Record<ImportStatus, number>
}

export interface ImportResultItem extends ImportPreviewItem {
    readonly outcome: 'imported' | 'skipped' | 'failed'
    readonly targetId?: string
}

export interface ImportResult {
    readonly runId: string
    readonly status: 'completed' | 'failed'
    readonly fingerprint: string
    readonly sourceSchema: string
    readonly items: readonly ImportResultItem[]
    readonly imported: number
    readonly skipped: number
    readonly failed: number
    readonly runtimeStatus: 'applied' | 'pending' | 'not_applicable'
}
