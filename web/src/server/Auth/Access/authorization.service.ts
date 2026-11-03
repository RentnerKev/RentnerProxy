import '@tanstack/react-start/server-only'

import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getCurrentSessionService, requireActiveSessionInTransaction } from './sessions.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'

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

export async function requireActiveSessionForSession(session: CurrentSession): Promise<void> {
    await getAuthDatabase().transaction((transaction) =>
        requireActiveSessionInTransaction(transaction, session),
    )
}
