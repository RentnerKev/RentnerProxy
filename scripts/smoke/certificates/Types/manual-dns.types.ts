export interface ManualDnsProof {
    readonly identifier: string
    readonly owner: string
    readonly value: string
    readonly expiresAt: string
}

export interface ManualDnsPause {
    readonly operationId: string
    readonly challengeSetId: string
    readonly expiresAt: string
    readonly lastCheckedAt: unknown
    readonly lastErrorCode: unknown
    readonly records: readonly ManualDnsProof[]
}
