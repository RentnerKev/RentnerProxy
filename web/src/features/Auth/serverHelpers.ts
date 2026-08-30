// oxlint-disable-next-line import/no-unassigned-import -- Marks these transport helpers as server-only.
import '@tanstack/react-start/server-only'

import {
    getRequest,
    getRequestIP,
    setResponseHeader,
    setResponseStatus,
} from '@tanstack/react-start/server'

import { isAuthDomainError } from '../../server/Auth/Core/errors.server'
import { isRecord } from '../../shared/Helpers/isRecord'
import { createPageError, getPageErrorDetails } from '../../shared/Helpers/pageError'
import {
    enforceAuthRateLimit,
    enforceLoginMfaRateLimit,
    RateLimitError,
    RateLimitUnavailableError,
    type AuthRateLimitAction,
} from '../../server/redis/rate-limiter.service'

export interface AuthActionResult {
    readonly success: boolean
    readonly message: string
}

export interface AuthActionFailureResult extends AuthActionResult {
    readonly success: false
}

export const AUTH_UNAVAILABLE_MESSAGE = 'Authentication service temporarily unavailable.'
export const GENERIC_LOGIN_MESSAGE = 'Invalid email or password.'
export const GENERIC_RESET_MESSAGE =
    'If an account exists for this email address, a password reset link has been sent.'

const MINIMUM_RESET_RESPONSE_MS = 600

function getPageErrorLogDetails(error: unknown) {
    const driverCodes = new Set<string>()
    const locations = new Set<string>()
    let cause = error
    for (let depth = 0; depth < 8 && isRecord(cause); depth += 1) {
        for (const value of [cause.code, cause.errno, cause.sqlState]) {
            if (
                typeof value === 'string' &&
                /^(?:[A-Z0-9]{5}|ERR_POSTGRES_[A-Z_]{1,80})$/u.test(value)
            ) {
                driverCodes.add(value)
            }
        }
        // Keep only project-relative call sites, never error messages, SQL, parameters, or URLs.
        const frames = typeof cause.stack === 'string' ? cause.stack.split('\n').slice(-16) : []
        for (const frame of frames) {
            const match =
                /^\s+at .+?[\\/](web[\\/](?:src|dist[\\/]server)[\\/][\w./\\$-]+:\d+:\d+)\)?$/u.exec(
                    frame,
                )
            if (match) locations.add(match[1]!.replaceAll('\\', '/'))
        }
        cause = cause.cause
    }
    return { driverCodes: [...driverCodes], locations: [...locations].slice(0, 12) }
}

export function throwPageError(error: unknown): never {
    const safeError = createPageError(error)
    const details = getPageErrorDetails(safeError)
    setResponseStatus(details.status)
    console.error('[page-error]', {
        code: details.code,
        reference: details.reference,
        ...getPageErrorLogDetails(error),
    })
    throw safeError
}

function setDomainErrorStatus(error: unknown): void {
    if (!isAuthDomainError(error)) {
        setResponseStatus(503)
        return
    }

    switch (error.code) {
        case 'authentication_required':
            setResponseStatus(401)
            return
        case 'reauthentication_required':
        case 'permission_denied':
        case 'owner_required':
            setResponseStatus(403)
            return
        case 'user_not_found':
        case 'role_not_found':
            setResponseStatus(404)
            return
        case 'email_conflict':
        case 'last_active_owner':
        case 'role_in_use':
        case 'system_role_immutable':
            setResponseStatus(409)
            return
        case 'invalid_email':
        case 'invalid_input':
        case 'password_policy':
        case 'unknown_permission':
        case 'unknown_role':
            setResponseStatus(400)
            return
        case 'service_unavailable':
        case 'user_not_active':
            setResponseStatus(503)
    }
}

function getDomainErrorMessage(error: unknown, fallback: string): string {
    if (!isAuthDomainError(error)) {
        return fallback
    }

    switch (error.code) {
        case 'authentication_required':
            return 'Your session has expired. Sign in again.'
        case 'reauthentication_required':
            return 'Confirm your identity to continue.'
        case 'email_conflict':
            return 'This email address is already in use.'
        case 'last_active_owner':
            return 'The last active owner cannot be disabled or changed.'
        case 'owner_required':
            return 'Only an owner can make this change.'
        case 'permission_denied':
            return 'You do not have permission to make this change.'
        case 'role_in_use':
            return 'This role is still assigned to a user.'
        case 'role_not_found':
            return 'The role no longer exists.'
        case 'system_role_immutable':
            return 'System roles cannot be changed or deleted.'
        case 'unknown_permission':
        case 'unknown_role':
            return 'One or more selected access rules are no longer available.'
        case 'user_not_found':
            return 'The user no longer exists.'
        case 'invalid_email':
        case 'invalid_input':
        case 'password_policy':
            return 'Review the submitted values and try again.'
        case 'service_unavailable':
        case 'user_not_active':
            return fallback
    }
}

export function actionFailure(error: unknown, fallback: string): AuthActionFailureResult {
    if (error instanceof RateLimitError) {
        setResponseStatus(429)
        setResponseHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))))
        return { success: false, message: 'Too many requests. Try again later.' }
    }

    if (error instanceof RateLimitUnavailableError) {
        setResponseStatus(503)
        return { success: false, message: AUTH_UNAVAILABLE_MESSAGE }
    }

    setDomainErrorStatus(error)
    return { success: false, message: getDomainErrorMessage(error, fallback) }
}

export function throwPublicQueryError(error: unknown): never {
    setDomainErrorStatus(error)
    throw new Error(getDomainErrorMessage(error, 'The requested data is temporarily unavailable.'))
}

function getLocalizedErrorKey(error: unknown, fallback: string): string {
    if (error instanceof RateLimitError) {
        return 'errors.rateLimited'
    }

    if (error instanceof RateLimitUnavailableError) {
        return 'errors.authUnavailable'
    }

    return isAuthDomainError(error) ? `errors.${error.code}` : fallback
}

export function localizedActionFailure(error: unknown, fallback: string): AuthActionFailureResult {
    actionFailure(error, fallback)
    return { success: false, message: getLocalizedErrorKey(error, fallback) }
}

export function throwLocalizedQueryError(error: unknown, fallback = 'common.requestFailed'): never {
    actionFailure(error, fallback)
    throw new Error(getLocalizedErrorKey(error, fallback))
}

export async function enforceSensitiveLimit(
    action: AuthRateLimitAction,
    identifier: string,
): Promise<void> {
    const request = getRequest()
    await enforceAuthRateLimit(
        { action, email: identifier, request },
        { resolveClientIp: () => getRequestIP() ?? 'unknown' },
    )
}

export async function enforceLoginMfaLimit(userId: string): Promise<void> {
    const request = getRequest()
    await enforceLoginMfaRateLimit(
        { request, userId },
        { resolveClientIp: () => getRequestIP() ?? 'unknown' },
    )
}

export async function enforceAnonymousSensitiveLimit(
    action: AuthRateLimitAction,
    scope: string,
): Promise<void> {
    const request = getRequest()
    const clientIp = getRequestIP() ?? 'unknown'
    await enforceAuthRateLimit(
        {
            action,
            email: `${scope}:${clientIp}`,
            request,
        },
        { resolveClientIp: () => clientIp },
    )
}

export async function waitForResetTimingFloor(startedAt: number): Promise<void> {
    const remaining = MINIMUM_RESET_RESPONSE_MS - (Date.now() - startedAt)

    if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
    }
}
