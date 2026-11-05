import { PASSWORD_MIN_LENGTH } from '@/config/auth.config.ts'

export const PASSWORD_TOO_LONG_MESSAGE = 'Password is too long.'

export function hasMinimumNewPasswordLength(password: string): boolean {
    return Array.from(password).length >= PASSWORD_MIN_LENGTH
}
