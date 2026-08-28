import '@tanstack/react-start/server-only'

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../config/auth.config'
import { AuthDomainError } from './errors.server'

export function isValidPassword(password: string): boolean {
    return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH
}

export function validatePassword(password: string): void {
    if (!isValidPassword(password)) {
        throw new AuthDomainError(
            'password_policy',
            `Password must contain between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
        )
    }
}

export async function hashPassword(password: string): Promise<string> {
    validatePassword(password)
    return Bun.password.hash(password, { algorithm: 'argon2id' })
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return Bun.password.verify(password, passwordHash)
}
