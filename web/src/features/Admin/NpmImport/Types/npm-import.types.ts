export type NpmImportStatus = 'ready' | 'partial' | 'manual' | 'conflict'

export type NpmImportKind =
    | 'proxy-host'
    | 'redirect-host'
    | 'access-policy'
    | 'certificate'
    | 'dead-host'
    | 'stream'

export interface NpmPreviewItem {
    readonly kind: NpmImportKind
    readonly sourceId: number
    readonly label: string
    readonly domains: readonly string[]
    readonly status: NpmImportStatus
    readonly reasons: readonly string[]
}

export interface NpmImportPreview {
    readonly fingerprint: string
    readonly planFingerprint: string
    readonly sourceSchema: string
    readonly items: readonly NpmPreviewItem[]
    readonly counts: Record<NpmImportStatus, number>
}

export interface NpmImportResultItem extends NpmPreviewItem {
    readonly outcome: 'imported' | 'skipped'
    readonly targetId?: string
}

export interface NpmImportResult {
    readonly runId: string
    readonly fingerprint: string
    readonly sourceSchema: string
    readonly items: readonly NpmImportResultItem[]
    readonly imported: number
    readonly skipped: number
    readonly runtimeStatus: 'applied' | 'pending'
}
