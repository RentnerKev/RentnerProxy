import '@tanstack/react-start/server-only'

import { AES_GCM_IV_BYTES } from '../../../config/auth-security.config'
import { getAppEncryptionKey } from '../../env.server'
import { AuthDomainError } from './errors.server'

export interface EncryptedSecret {
    readonly ciphertext: Uint8Array
    readonly iv: Uint8Array
}

function unavailable(): AuthDomainError {
    return new AuthDomainError('service_unavailable', 'Secret encryption is unavailable.')
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return copy
}

async function getEncryptionKey(): Promise<CryptoKey> {
    const keyBytes = getAppEncryptionKey()

    if (!keyBytes) {
        throw unavailable()
    }

    try {
        return await crypto.subtle.importKey('raw', copyBytes(keyBytes), 'AES-GCM', false, [
            'encrypt',
            'decrypt',
        ])
    } catch {
        throw unavailable()
    }
}

function getAdditionalData(context: string): Uint8Array<ArrayBuffer> {
    if (!context || context.length > 512) {
        throw unavailable()
    }

    return new TextEncoder().encode(context)
}

export function isSecretEncryptionAvailable(): boolean {
    return getAppEncryptionKey() !== null
}

export async function encryptSecret(plaintext: string, context: string): Promise<EncryptedSecret> {
    if (!plaintext) {
        throw unavailable()
    }

    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))

    try {
        const ciphertext = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv,
                additionalData: getAdditionalData(context),
            },
            await getEncryptionKey(),
            new TextEncoder().encode(plaintext),
        )

        return { ciphertext: new Uint8Array(ciphertext), iv }
    } catch (error) {
        if (error instanceof AuthDomainError) {
            throw error
        }

        throw unavailable()
    }
}

export async function decryptSecret(encrypted: EncryptedSecret, context: string): Promise<string> {
    if (encrypted.iv.byteLength !== AES_GCM_IV_BYTES || encrypted.ciphertext.byteLength < 17) {
        throw unavailable()
    }

    try {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: copyBytes(encrypted.iv),
                additionalData: getAdditionalData(context),
            },
            await getEncryptionKey(),
            copyBytes(encrypted.ciphertext),
        )

        return new TextDecoder().decode(plaintext)
    } catch (error) {
        if (error instanceof AuthDomainError) {
            throw error
        }

        throw unavailable()
    }
}

export function encodeBase64Url(value: Uint8Array): string {
    return Buffer.from(value).toString('base64url')
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        return null
    }

    try {
        const decoded = Buffer.from(value, 'base64url')
        return decoded.toString('base64url') === value ? copyBytes(decoded) : null
    } catch {
        return null
    }
}
