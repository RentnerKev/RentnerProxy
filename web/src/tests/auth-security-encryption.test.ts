import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const originalEncryptionKey = process.env.APP_ENCRYPTION_KEY
const keyA = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
const keyB = Buffer.from(new Uint8Array(32).fill(8)).toString('base64')

beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = keyA
})

afterEach(() => {
    if (originalEncryptionKey === undefined) {
        delete process.env.APP_ENCRYPTION_KEY
    } else {
        process.env.APP_ENCRYPTION_KEY = originalEncryptionKey
    }
})

const { decryptSecret, encryptSecret } = await import('../server/Auth/Core/encryption.server')

describe('authentication secret encryption', () => {
    test('round-trips a secret with authenticated context', async () => {
        const encrypted = await encryptSecret('totp-secret-value', 'user:user-1:totp')

        expect(encrypted.iv).toHaveLength(12)
        expect(encrypted.ciphertext.byteLength).toBeGreaterThan(16)
        const encryptedAgain = await encryptSecret('totp-secret-value', 'user:user-1:totp')
        expect(encryptedAgain.iv).not.toEqual(encrypted.iv)
        expect(encryptedAgain.ciphertext).not.toEqual(encrypted.ciphertext)

        expect(await decryptSecret(encrypted, 'user:user-1:totp')).toBe('totp-secret-value')
        expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('totp-secret-value')
    })

    test('rejects ciphertext, IV, and context tampering', async () => {
        const encrypted = await encryptSecret('recovery-secret', 'user:user-2:totp')
        const tamperedCiphertext = new Uint8Array(encrypted.ciphertext)
        tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1
        const tamperedIv = new Uint8Array(encrypted.iv)
        tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 1

        await expect(
            decryptSecret({ ciphertext: tamperedCiphertext, iv: encrypted.iv }, 'user:user-2:totp'),
        ).rejects.toMatchObject({ code: 'service_unavailable' })
        await expect(
            decryptSecret({ ciphertext: encrypted.ciphertext, iv: tamperedIv }, 'user:user-2:totp'),
        ).rejects.toMatchObject({ code: 'service_unavailable' })
        await expect(decryptSecret(encrypted, 'user:user-2:other-context')).rejects.toMatchObject({
            code: 'service_unavailable',
        })
    })

    test('fails closed when the key changes or is unavailable', async () => {
        const encrypted = await encryptSecret('secret', 'user:user-3:totp')
        process.env.APP_ENCRYPTION_KEY = keyB

        await expect(decryptSecret(encrypted, 'user:user-3:totp')).rejects.toMatchObject({
            code: 'service_unavailable',
        })

        delete process.env.APP_ENCRYPTION_KEY
        await expect(encryptSecret('secret', 'user:user-3:totp')).rejects.toMatchObject({
            code: 'service_unavailable',
        })
    })
})
