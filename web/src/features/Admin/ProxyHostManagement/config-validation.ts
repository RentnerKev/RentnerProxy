import { z } from 'zod'

import { PROXY_HTTP_SETTINGS } from '../../../config/proxy-http.config'
import type { ProxyHttpSettings } from '../../../shared/Types/proxy-runtime.types'

export const proxyHttpSettingsSchema = z.strictObject({
    clientMaxBodySizeBytes: z.number().int().min(1_024).max(1_073_741_824).optional(),
    proxyConnectTimeoutSeconds: z.number().int().min(1).max(60).optional(),
    proxyReadTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
    proxySendTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
    sendTimeoutSeconds: z.number().int().min(1).max(300).optional(),
    keepaliveTimeoutSeconds: z.number().int().min(1).max(300).optional(),
})

export const proxyHostHttpSettingsSchema = proxyHttpSettingsSchema.omit({
    sendTimeoutSeconds: true,
    keepaliveTimeoutSeconds: true,
})

export const proxyConfigEditorSaveSchema = z.strictObject({
    baseRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings: proxyHttpSettingsSchema,
})

export const proxyConfigEditorResetSchema = proxyConfigEditorSaveSchema.omit({
    settings: true,
})

export function normalizeProxyHttpSettings(input: unknown): ProxyHttpSettings {
    const settings = proxyHttpSettingsSchema.parse(input)
    return Object.fromEntries(
        PROXY_HTTP_SETTINGS.flatMap(({ key }) => {
            const value = settings[key]
            return value === undefined ? [] : [[key, value]]
        }),
    )
}

export function normalizeProxyHostHttpSettings(input: unknown): ProxyHttpSettings {
    const settings = proxyHostHttpSettingsSchema.parse(input)
    return Object.fromEntries(
        PROXY_HTTP_SETTINGS.flatMap(({ key }) => {
            if (key === 'sendTimeoutSeconds' || key === 'keepaliveTimeoutSeconds') return []
            const value = settings[key]
            return value === undefined ? [] : [[key, value]]
        }),
    )
}

export const proxyHostConfigEditorIdSchema = z.strictObject({
    proxyHostId: z.uuid().transform((value) => value.toLowerCase()),
})

export const proxyHostConfigEditorSaveSchema = proxyHostConfigEditorIdSchema.extend({
    baseRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings: proxyHostHttpSettingsSchema,
})

export const proxyHostConfigEditorResetSchema = proxyConfigEditorResetSchema.extend({
    ...proxyHostConfigEditorIdSchema.shape,
})

export const proxyHostConfigEditorPreviewSchema = proxyHostConfigEditorIdSchema.extend({
    settings: proxyHostHttpSettingsSchema,
})
