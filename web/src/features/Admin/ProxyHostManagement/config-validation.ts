import { z } from 'zod'

import { PROXY_HTTP_SETTINGS } from '@/config/proxy-http.config.ts'
import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export const browserCacheSettingsSchema = z
    .strictObject({
        enabled: z.boolean(),
        rules: z
            .array(
                z.strictObject({
                    path: z
                        .string()
                        .min(2)
                        .max(512)
                        .regex(
                            /^\/(?:(?:[A-Za-z0-9_-]+\/)+|(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:css|js|mjs|png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf))$/u,
                        )
                        .refine(
                            (path) =>
                                !path.includes('..') &&
                                !/^\/(?:api|auth|admin|login|logout|oauth|session)(?:\/|$)/iu.test(
                                    path,
                                ),
                        ),
                    maxAgeSeconds: z.number().int().min(1).max(31_536_000),
                    immutable: z.boolean(),
                }),
            )
            .max(20),
    })
    .refine((settings) => !settings.enabled || settings.rules.length > 0)
    .refine(
        (settings) =>
            new Set(settings.rules.map((rule) => rule.path.toLowerCase())).size ===
            settings.rules.length,
    )
    .refine(
        (settings) =>
            !settings.rules.some((rule, index) =>
                settings.rules.some(
                    (other, otherIndex) =>
                        index !== otherIndex &&
                        rule.path.endsWith('/') &&
                        other.path.toLowerCase().startsWith(rule.path.toLowerCase()),
                ),
            ),
    )

export const proxyHttpSettingsSchema = z.strictObject({
    responseCompression: z.enum(['auto', 'off']).optional(),
    browserCache: browserCacheSettingsSchema.optional(),
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
    settings: proxyHttpSettingsSchema.omit({ browserCache: true }),
})

export const proxyConfigEditorResetSchema = proxyConfigEditorSaveSchema.omit({
    settings: true,
})

export function normalizeProxyHttpSettings(input: unknown): ProxyHttpSettings {
    const settings = proxyHttpSettingsSchema.parse(input)
    return {
        ...(settings.responseCompression === undefined
            ? {}
            : { responseCompression: settings.responseCompression }),
        ...(settings.browserCache === undefined ? {} : { browserCache: settings.browserCache }),
        ...Object.fromEntries(
            PROXY_HTTP_SETTINGS.flatMap(({ key }) => {
                const value = settings[key]
                return value === undefined ? [] : [[key, value]]
            }),
        ),
    }
}

export function normalizeProxyHostHttpSettings(input: unknown): ProxyHttpSettings {
    const settings = proxyHostHttpSettingsSchema.parse(input)
    return {
        ...(settings.responseCompression === undefined
            ? {}
            : { responseCompression: settings.responseCompression }),
        ...(settings.browserCache === undefined ? {} : { browserCache: settings.browserCache }),
        ...Object.fromEntries(
            PROXY_HTTP_SETTINGS.flatMap(({ key }) => {
                if (key === 'sendTimeoutSeconds' || key === 'keepaliveTimeoutSeconds') return []
                const value = settings[key]
                return value === undefined ? [] : [[key, value]]
            }),
        ),
    }
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
