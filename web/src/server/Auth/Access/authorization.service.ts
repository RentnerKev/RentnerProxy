import '@tanstack/react-start/server-only'

import { RECENT_AUTHENTICATION_DURATION_MS } from '../../../config/auth-security.config'
import type { PermissionKey } from '../../../config/permissions.config'
import type { AuthenticatedUser } from '../../../shared/Types/auth.types'
import type { CurrentSession } from '../Core/Types/auth-service.types'
import { AuthDomainError } from '../Core/errors.server'
import { getCurrentSessionService } from './sessions.service'

export async function requireSessionService(): Promise<CurrentSession> {
    const session = await getCurrentSessionService()

    if (!session) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    return session
}

export async function requireUserService(): Promise<AuthenticatedUser> {
    const session = await requireSessionService()
    return session.user
}

export async function requirePermissionService(
    permission: PermissionKey,
): Promise<AuthenticatedUser> {
    const user = await requireUserService()

    if (!user.permissions.includes(permission)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }

    return user
}

export async function requireSessionPermission(
    session: CurrentSession,
    permission: PermissionKey,
): Promise<void> {
    if (!session.user.permissions.includes(permission)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }
}

export function isSessionRecentlyAuthenticated(session: CurrentSession, now = Date.now()): boolean {
    const authenticationAge = now - session.reauthenticatedAt.getTime()
    return authenticationAge >= 0 && authenticationAge <= RECENT_AUTHENTICATION_DURATION_MS
}

export async function requireRecentAuthenticationForSession(
    session: CurrentSession,
): Promise<void> {
    if (!isSessionRecentlyAuthenticated(session)) {
        throw new AuthDomainError('reauthentication_required', 'Recent authentication is required.')
    }
}
