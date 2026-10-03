export interface TrustedCaSummary {
    readonly id: string
    readonly name: string
    readonly subject: string
    readonly issuer: string
    readonly fingerprintSha256: string
    readonly notBefore: Date
    readonly notAfter: Date
    readonly assignedHostCount: number
    readonly createdAt: Date
    readonly updatedAt: Date
}
