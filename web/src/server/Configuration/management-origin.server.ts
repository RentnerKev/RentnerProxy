import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { parseTrustedManagementOrigin } from '../../config/management-origin.config'
import { systemSettings } from '../../db/schema'
import { getAppUrl, parseWebAuthnRpId, type WebAuthnConfiguration } from '../env.server'
import { getAuthDatabase, type AuthTransaction } from '../Auth/Core/database.server'

export const MANAGEMENT_ORIGIN_SETTINGS_KEY = 'management_origin_v1'

const storedManagementOriginSchema = z.strictObject({
    version: z.literal(1),
    origin: z.string(),
})

export async function writeManagementOriginInTransaction(
    transaction: AuthTransaction,
    origin: string,
): Promise<void> {
    await transaction
        .insert(systemSettings)
        .values({ key: MANAGEMENT_ORIGIN_SETTINGS_KEY, value: { origin, version: 1 } })
        .onConflictDoUpdate({
            target: systemSettings.key,
            set: { updatedAt: new Date(), value: { origin, version: 1 } },
        })
}

export async function getStoredManagementOrigin(): Promise<string | null> {
    const rows = await getAuthDatabase()
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, MANAGEMENT_ORIGIN_SETTINGS_KEY))
        .limit(1)
    const row = rows.at(0)
    if (!row) return null
    const stored = storedManagementOriginSchema.safeParse(row.value)
    return stored.success ? parseTrustedManagementOrigin(stored.data.origin) : null
}

export async function getRuntimeManagementOrigin(): Promise<string | null> {
    if (process.env.APP_URL !== undefined) {
        return getAppUrl()
    }
    return getStoredManagementOrigin()
}

export async function getRuntimeWebAuthnConfiguration(): Promise<WebAuthnConfiguration | null> {
    const origin = await getRuntimeManagementOrigin()
    if (!origin) return null
    const configuredRpId = process.env.WEBAUTHN_RP_ID ?? new URL(origin).hostname
    const rpId = parseWebAuthnRpId(configuredRpId, origin)
    return rpId ? { origin, rpId, rpName: 'RentnerProxy' } : null
}
