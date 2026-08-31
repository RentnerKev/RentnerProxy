// oxlint-disable-next-line import/no-unassigned-import -- Keeps configuration persistence behind the server boundary.
import '@tanstack/react-start/server-only'

import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { systemSettings } from '../../db/schema'
import {
    normalizeProxyHttpSettings,
    proxyHttpSettingsSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'
import type { ProxyHttpSettings } from '../../shared/Types/proxy-runtime.types'
import type { AuthTransaction } from '../Auth/Core/database.server'

export const PROXY_RUNTIME_SETTINGS_KEY = 'proxy_runtime_editor_v1'

const storedSettingsSchema = z.strictObject({
    version: z.literal(1),
    httpSettings: proxyHttpSettingsSchema,
})

export async function readProxyHttpSettings(
    transaction: AuthTransaction,
): Promise<ProxyHttpSettings> {
    const rows = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
        .limit(1)
    const row = rows.at(0)
    if (!row) return {}

    const stored = storedSettingsSchema.safeParse(row.value)
    if (!stored.success) throw new Error('Stored proxy HTTP settings are invalid.')
    return normalizeProxyHttpSettings(stored.data.httpSettings)
}

// Every host/editor mutation takes this lock before reading or changing desired
// configuration, so stale editor saves cannot overwrite a newer host revision.
export async function lockProxyRuntimeSettings(transaction: AuthTransaction): Promise<void> {
    await transaction
        .insert(systemSettings)
        .values({ key: PROXY_RUNTIME_SETTINGS_KEY, value: { version: 1, httpSettings: {} } })
        .onConflictDoNothing({ target: systemSettings.key })
    await transaction
        .select({ id: systemSettings.id })
        .from(systemSettings)
        .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
        .for('update')
}

export async function writeProxyHttpSettings(
    transaction: AuthTransaction,
    httpSettings: ProxyHttpSettings,
): Promise<void> {
    await transaction
        .update(systemSettings)
        .set({ value: { version: 1, httpSettings }, updatedAt: new Date() })
        .where(eq(systemSettings.key, PROXY_RUNTIME_SETTINGS_KEY))
}

const HOST_SETTINGS_PREFIX = 'proxy_runtime_host_v1:'

function hostSettingsKey(proxyHostId: string): string {
    return HOST_SETTINGS_PREFIX + z.uuid().parse(proxyHostId).toLowerCase()
}

export async function readProxyHostHttpSettings(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<ProxyHttpSettings> {
    const rows = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, hostSettingsKey(proxyHostId)))
        .limit(1)
    const row = rows.at(0)
    if (!row) return {}
    const stored = storedSettingsSchema.safeParse(row.value)
    if (!stored.success) throw new Error('Stored proxy host HTTP settings are invalid.')
    return normalizeProxyHttpSettings(stored.data.httpSettings)
}

export async function readProxyHostHttpSettingsMap(
    transaction: AuthTransaction,
    proxyHostIds: readonly string[],
): Promise<Map<string, ProxyHttpSettings>> {
    if (proxyHostIds.length === 0) return new Map()
    const rows = await transaction
        .select({ key: systemSettings.key, value: systemSettings.value })
        .from(systemSettings)
        .where(inArray(systemSettings.key, proxyHostIds.map(hostSettingsKey)))
    const result = new Map<string, ProxyHttpSettings>()
    for (const row of rows) {
        const stored = storedSettingsSchema.safeParse(row.value)
        if (!stored.success) throw new Error('Stored proxy host HTTP settings are invalid.')
        result.set(
            row.key.slice(HOST_SETTINGS_PREFIX.length),
            normalizeProxyHttpSettings(stored.data.httpSettings),
        )
    }
    return result
}

// Callers hold the shared runtime settings lock before changing a host override.
export async function writeProxyHostHttpSettings(
    transaction: AuthTransaction,
    proxyHostId: string,
    settings: ProxyHttpSettings,
): Promise<void> {
    const key = hostSettingsKey(proxyHostId)
    const httpSettings = normalizeProxyHttpSettings(settings)
    if (Object.keys(httpSettings).length === 0) {
        await transaction.delete(systemSettings).where(eq(systemSettings.key, key))
        return
    }
    const value = { version: 1, httpSettings }
    await transaction
        .insert(systemSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } })
}
