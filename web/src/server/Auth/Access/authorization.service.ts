import '@tanstack/react-start/server-only'

import type { PermissionKey } from '../../../config/permissions.config'
import type { AuthenticatedUser } from '../../../shared/Types/auth.types'
import { AuthDomainError } from '../Core/errors.server'
import { getCurrentSessionService } from './sessions.service'

export async function requireUserService(): Promise<AuthenticatedUser> {
    const session = await getCurrentSessionService()

    if (!session) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

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
