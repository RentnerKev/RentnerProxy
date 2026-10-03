export interface EncryptedSecret {
    readonly ciphertext: Uint8Array
    readonly iv: Uint8Array
}
