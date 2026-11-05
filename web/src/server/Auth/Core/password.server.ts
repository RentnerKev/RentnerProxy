import '@tanstack/react-start/server-only'

import { PASSWORD_MAX_LENGTH } from '@/config/auth.config.ts'
import { hasMinimumNewPasswordLength } from '@/lib/Auth/passwordPolicy.ts'
import { AuthDomainError } from './errors.server.ts'

export function isValidPassword(password: string): boolean {
    return password.length > 0 && password.length <= PASSWORD_MAX_LENGTH
}

export function isValidNewPassword(password: string): boolean {
    return password.length <= PASSWORD_MAX_LENGTH && hasMinimumNewPasswordLength(password)
}

function validatePassword(password: string): void {
    if (!isValidNewPassword(password)) {
        throw new AuthDomainError(
            'password_policy',
            'Password does not meet the length requirements.',
        )
    }
}

export async function hashPassword(password: string): Promise<string> {
    validatePassword(password)
    return Bun.password.hash(password, { algorithm: 'argon2id' })
}
