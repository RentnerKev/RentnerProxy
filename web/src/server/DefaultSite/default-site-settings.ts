// oxlint-disable-next-line import/no-unassigned-import -- Settings persistence stays on the server boundary.
import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { systemSettings } from '@/db/schema.ts'
import { defaultSiteSettingsSchema } from '@/lib/DefaultSite/defaultSite.ts'
import type { DefaultSiteSettings } from '@/shared/Types/default-site.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/database.server.ts'

export const DEFAULT_SITE_SETTINGS_KEY = 'default_site_v1'

const storedSettingsSchema = z.strictObject({
    version: z.literal(1),
    settings: defaultSiteSettingsSchema,
})

export function parseStoredDefaultSiteSettings(input: unknown): DefaultSiteSettings {
    let value = input
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            throw new Error('Stored default site settings are invalid.')
        }
    }
    const result = storedSettingsSchema.safeParse(value)
    if (!result.success) throw new Error('Stored default site settings are invalid.')
    return result.data.settings
}

export async function readDefaultSiteSettings(
    transaction: AuthTransaction,
): Promise<DefaultSiteSettings> {
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, DEFAULT_SITE_SETTINGS_KEY))
        .limit(1)
    return row ? parseStoredDefaultSiteSettings(row.value) : { mode: 'not-found' }
}

export async function writeDefaultSiteSettings(
    transaction: AuthTransaction,
    settings: DefaultSiteSettings,
): Promise<void> {
    const value = { version: 1, settings: defaultSiteSettingsSchema.parse(settings) }
    await transaction
        .insert(systemSettings)
        .values({ key: DEFAULT_SITE_SETTINGS_KEY, value: sql`${value}` })
        .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: sql`${value}`, updatedAt: new Date() },
        })
}
