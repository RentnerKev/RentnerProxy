interface ImportResultItem {
    readonly kind: 'proxy-host'
    readonly sourceId: number
    readonly label: string
    readonly domains: readonly string[]
    readonly status: 'manual'
    readonly reasons: readonly string[]
    readonly outcome: 'skipped'
}

export interface ImportResult {
    readonly status: 'completed'
    readonly items: readonly ImportResultItem[]
    readonly imported: 0
    readonly skipped: 1
    readonly failed: 0
}

export interface BetaBackupStateFixture {
    readonly forwardAuthPolicyId: string
    readonly importerRunId: string
    readonly sourceFingerprint: string
    readonly sourceSchema: 'npm-2.16-schema'
    readonly expectedForwardAuthJson: string
    readonly expectedImporterResultJson: string
}
