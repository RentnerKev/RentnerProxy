import { createCipheriv, createHash, randomBytes } from 'node:crypto'

import type { Alpha4CertificateRequest } from './types'

export const APP_ENCRYPTION_KEY_BYTES = 32
export const AES_GCM_IV_BYTES = 12

function canonicalValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, entry]) => [key, canonicalValue(entry)]),
        )
    }
    return value
}

export function digest(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalValue(value)))
        .digest('hex')
}

export function uuidV7(): string {
    const bytes = randomBytes(16)
    const timestamp = BigInt(Date.now())
    bytes[0] = Number((timestamp >> 40n) & 0xffn)
    bytes[1] = Number((timestamp >> 32n) & 0xffn)
    bytes[2] = Number((timestamp >> 24n) & 0xffn)
    bytes[3] = Number((timestamp >> 16n) & 0xffn)
    bytes[4] = Number((timestamp >> 8n) & 0xffn)
    bytes[5] = Number(timestamp & 0xffn)
    bytes[6] = (bytes[6]! & 0x0f) | 0x70
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function decodeApplicationKey(encoded: string): {
    readonly bytes: Buffer
    readonly digest: string
} {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength !== APP_ENCRYPTION_KEY_BYTES || bytes.toString('base64') !== encoded) {
        throw new Error('Alpha 4 fixture application encryption key is invalid.')
    }
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') }
}

export function encryptRequest(
    request: Alpha4CertificateRequest,
    key: Buffer,
    context: string,
): { readonly ciphertext: Buffer; readonly iv: Buffer } {
    const iv = randomBytes(AES_GCM_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(context, 'utf8'))
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(request), 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    return { ciphertext, iv }
}
