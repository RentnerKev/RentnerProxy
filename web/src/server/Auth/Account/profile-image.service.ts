import '@tanstack/react-start/server-only'

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { PERMISSIONS } from '../../../config/permissions.config'
import { users } from '../../../db/schema'
import { requirePermissionInTransaction } from '../Access/rbac.service'
import { getCurrentSessionService } from '../Access/sessions.service'
import { getAuthDatabase } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import { createNormalizedProfileImageWebp } from './profile-image-processing.server'

export interface ProfileImageAsset {
    readonly bytes: Uint8Array
}

export async function updateCurrentProfileImageService(dataUrl: string): Promise<void> {
    const currentSession = await getCurrentSessionService()

    if (!currentSession) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    if (!currentSession.user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }

    const profileImageWebp = await createNormalizedProfileImageWebp(dataUrl)
    const db = getAuthDatabase()

    await db.transaction(async (transaction) => {
        await requirePermissionInTransaction(
            transaction,
            currentSession.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )

        const updatedRows = await transaction
            .update(users)
            .set({
                profileImageVersion: sql`${users.profileImageVersion} + 1`,
                profileImageWebp,
                updatedAt: new Date(),
            })
            .where(and(eq(users.id, currentSession.user.id), eq(users.status, 'active')))
            .returning({ id: users.id })

        if (!updatedRows.at(0)) {
            throw new AuthDomainError('authentication_required', 'Authentication is required.')
        }
    })
}

export async function getProfileImageAssetService(
    userId: string,
    version: number,
): Promise<ProfileImageAsset | null> {
    if (!z.uuid().safeParse(userId).success || !Number.isSafeInteger(version) || version < 1) {
        return null
    }

    const currentSession = await getCurrentSessionService()

    if (
        !currentSession ||
        !currentSession.user.permissions.includes(PERMISSIONS.APP_ACCESS) ||
        (currentSession.user.id !== userId &&
            !currentSession.user.permissions.includes(PERMISSIONS.USERS_VIEW))
    ) {
        return null
    }

    const rows = await getAuthDatabase()
        .select({
            bytes: users.profileImageWebp,
        })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.profileImageVersion, version)))
        .limit(1)
    const asset = rows.at(0)

    return asset?.bytes ? { bytes: asset.bytes } : null
}
