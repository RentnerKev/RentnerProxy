export interface AuthFixture {
    readonly sessionId: string
    readonly sessionTokenHash: string
    readonly recoveryId: string
    readonly recoveryHash: string
    readonly passkeyId: string
    readonly credentialId: string
    readonly publicKeyHex: string
    readonly totpId: string
    readonly totpSecret: string
    readonly ciphertextHex: string
    readonly ivHex: string
}
