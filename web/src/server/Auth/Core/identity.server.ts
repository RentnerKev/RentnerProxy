import '@tanstack/react-start/server-only'

import { z } from 'zod'

import { AuthDomainError } from './errors.server'

const normalizedEmailSchema = z.email().max(254)
export const PENDING_DISPLAY_NAME = 'Pending invitation'

export function normalizeEmail(email: string): string {
    const normalizedEmail = email.trim().toLowerCase()
    const result = normalizedEmailSchema.safeParse(normalizedEmail)

    if (!result.success) {
        throw new AuthDomainError('invalid_email', 'Email address is invalid.')
    }

    return result.data
}

export function normalizeDisplayName(displayName: string): string {
    const normalizedDisplayName = displayName.trim()

    if (normalizedDisplayName.length < 2 || normalizedDisplayName.length > 100) {
        throw new AuthDomainError('invalid_input', 'Display name is invalid.')
    }

    return normalizedDisplayName
}

export function normalizePendingDisplayName(displayName: string | undefined): string {
    if (displayName === undefined || displayName.trim() === '') {
        return PENDING_DISPLAY_NAME
    }

    return normalizeDisplayName(displayName)
}
