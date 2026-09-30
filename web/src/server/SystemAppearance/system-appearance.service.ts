import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'

import {
    DEFAULT_ACCENT_COLOR,
    parseStoredSystemAppearance,
    type SystemAccentColorUpdate,
} from '../../config/appearance.config'
import { PERMISSIONS } from '../../config/permissions.config'
import { systemSettings } from '../../db/schema'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'

export const SYSTEM_APPEARANCE_SETTINGS_KEY = 'system_appearance_v1'

function requireStoredSystemAppearance(input: unknown): string {
    const accentColor = parseStoredSystemAppearance(input)
    if (accentColor === null) {
        throw new AuthDomainError('service_unavailable', 'System appearance is unavailable.')
    }
    return accentColor
}

export async function getSystemAccentColorService(): Promise<string> {
    const [row] = await getAuthDatabase()
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, SYSTEM_APPEARANCE_SETTINGS_KEY))
        .limit(1)

    return row ? requireStoredSystemAppearance(row.value) : DEFAULT_ACCENT_COLOR
}

export async function updateSystemAccentColorService(
    input: SystemAccentColorUpdate,
): Promise<string> {
    await requirePermissionService(PERMISSIONS.SYSTEM_APPEARANCE_UPDATE)
    const accentColor = input.accentColor ?? DEFAULT_ACCENT_COLOR
    const value = { version: 1 as const, accentColor }
    const rows = await getAuthDatabase()
        .insert(systemSettings)
        .values({ key: SYSTEM_APPEARANCE_SETTINGS_KEY, value: sql`${value}` })
        .onConflictDoUpdate({
            target: systemSettings.key,
            set: { updatedAt: new Date(), value: sql`${value}` },
        })
        .returning({ value: systemSettings.value })
    const saved = rows.at(0)
    if (!saved) {
        throw new AuthDomainError('service_unavailable', 'System appearance could not be saved.')
    }
    return requireStoredSystemAppearance(saved.value)
}
