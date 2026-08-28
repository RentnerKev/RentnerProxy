import '@tanstack/react-start/server-only'

import { randomBytes } from 'node:crypto'

import { OPAQUE_TOKEN_BYTES, OPAQUE_TOKEN_PATTERN } from '../../../config/auth.config'
import { AuthDomainError } from './errors.server'

export function createOpaqueToken(): string {
    return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url')
}

export function isValidOpaqueToken(token: string): boolean {
    return OPAQUE_TOKEN_PATTERN.test(token)
}

export async function hashOpaqueToken(token: string): Promise<string> {
    if (!isValidOpaqueToken(token)) {
        throw new AuthDomainError('invalid_input', 'Token format is invalid.')
    }

    const tokenBytes = new TextEncoder().encode(token)
    const digest = await crypto.subtle.digest('SHA-256', tokenBytes)
    return Buffer.from(digest).toString('hex')
}
