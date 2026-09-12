import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { parseTrustedManagementOrigin } from '../../config/management-origin.config'
import { systemSettings } from '../../db/schema'
import { deriveWebAuthnRpId, getPublicOrigin, type WebAuthnConfiguration } from '../env.server'
import { getAuthDatabase } from '../Auth/Core/database.server'

export const MANAGEMENT_ORIGIN_SETTINGS_KEY = 'management_origin_v1'

const storedManagementOriginSchema = z.strictObject({
    version: z.literal(1),
    origin: z.string(),
})

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
    return getPublicOrigin()
}

export async function getRuntimeWebAuthnConfiguration(): Promise<WebAuthnConfiguration | null> {
    const origin = await getRuntimeManagementOrigin()
    if (!origin) return null
    const rpId = deriveWebAuthnRpId(origin)
    return rpId ? { origin, rpId, rpName: 'RentnerProxy' } : null
}
