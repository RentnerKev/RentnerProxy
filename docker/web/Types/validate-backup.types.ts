export interface BackupMigrationJournal {
    readonly entries: ReadonlyArray<{
        readonly tag: string
        readonly when: number
    }>
}

export interface BackupMigrationRow {
    readonly hash: string
    readonly created_at: string | number | bigint
}

export interface BackupTotpSecretRow {
    readonly user_id: string
    readonly secret_ciphertext: Uint8Array
    readonly secret_iv: Uint8Array
}

export interface BackupCertificateJobRow {
    readonly id: string
    readonly request_ciphertext: Uint8Array
    readonly request_iv: Uint8Array
}

export interface BackupCrowdSecSettingRow {
    readonly value: unknown
}
