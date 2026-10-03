import '@tanstack/react-start/server-only'

import { sql } from 'drizzle-orm'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import {
    parseStoredUserAppearance,
    userAppearanceSettingsKey,
} from '@/lib/UserSettings/appearance.ts'
import type {
    UserAccentColor,
    UserAccentColorUpdate,
} from '@/config/Types/appearance-config.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { systemSettings } from '@/db/schema.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

function requireStoredUserAppearance(input: unknown): string {
    const accentColor = parseStoredUserAppearance(input)
    if (accentColor === null) {
        throw new AuthDomainError('service_unavailable', 'User appearance is unavailable.')
    }
    return accentColor
}

export async function updateCurrentUserAccentColorService(
    input: UserAccentColorUpdate,
): Promise<UserAccentColor> {
    const user = await requirePermissionService(PERMISSIONS.APP_ACCESS)
    if (input.expectedUserId !== user.id) {
        throw new AuthDomainError('authentication_required', 'The signed-in user has changed.')
    }

    const accentColor = input.accentColor ?? DEFAULT_ACCENT_COLOR
    const value = { version: 1 as const, accentColor }
    const rows = await getAuthDatabase()
        .insert(systemSettings)
        .values({ key: userAppearanceSettingsKey(user.id), value: sql`${value}` })
        .onConflictDoUpdate({
            target: systemSettings.key,
            set: { updatedAt: new Date(), value: sql`${value}` },
        })
        .returning({ value: systemSettings.value })
    const saved = rows.at(0)
    if (!saved) {
        throw new AuthDomainError('service_unavailable', 'User appearance could not be saved.')
    }
    return { userId: user.id, accentColor: requireStoredUserAppearance(saved.value) }
}
