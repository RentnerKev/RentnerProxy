import { PASSWORD_MIN_LENGTH } from '@/config/auth.config.ts'

export const PASSWORD_TOO_LONG_MESSAGE = 'Password is too long.'

export function hasMinimumNewPasswordLength(password: string): boolean {
    const codePoints = password[Symbol.iterator]()
    for (let count = 0; count < PASSWORD_MIN_LENGTH; count += 1) {
        if (codePoints.next().done) return false
    }
    return true
}
