import { z } from 'zod'

import {
    MAX_PROXY_ADVANCED_CONFIG_BYTES,
    MAX_PROXY_SETTINGS_SOURCE_LENGTH,
    PROXY_HTTP_SETTINGS,
} from '../../../config/proxy-http.config'
import type { ProxyHttpSettings } from '../../../shared/Types/proxy-runtime.types'

// Expert text has no directive allowlist. Only normalize transport line endings.
export const proxyAdvancedConfigSchema = z
    .string('admin.proxyHosts.config.errors.invalidAdvancedConfig')
    .transform((value) => value.replaceAll('\r\n', '\n'))
    .superRefine((value, context) => {
        if (!value.isWellFormed() || value.includes('\0')) {
            context.addIssue({
                code: 'custom',
                message: 'admin.proxyHosts.config.errors.invalidAdvancedConfig',
            })
        }
        if (new TextEncoder().encode(value).byteLength > MAX_PROXY_ADVANCED_CONFIG_BYTES) {
            context.addIssue({
                code: 'custom',
                message: 'admin.proxyHosts.config.errors.advancedConfigTooLarge',
            })
        }
    })

export const proxyHttpSettingsSchema = z.strictObject({
    clientMaxBodySizeBytes: z.number().int().min(1_024).max(1_073_741_824).optional(),
    proxyConnectTimeoutSeconds: z.number().int().min(1).max(60).optional(),
    proxyReadTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
    proxySendTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
    sendTimeoutSeconds: z.number().int().min(1).max(300).optional(),
    keepaliveTimeoutSeconds: z.number().int().min(1).max(300).optional(),
})

export const proxyConfigEditorSaveSchema = z.strictObject({
    baseRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settingsSource: z.string().max(MAX_PROXY_SETTINGS_SOURCE_LENGTH),
})

export const proxyConfigEditorResetSchema = proxyConfigEditorSaveSchema.omit({
    settingsSource: true,
})

export class ProxyHttpSettingsParseError extends Error {
    constructor(readonly line: number) {
        super('Invalid HTTP setting.')
    }
}

export function normalizeProxyHttpSettings(input: unknown): ProxyHttpSettings {
    const settings = proxyHttpSettingsSchema.parse(input)
    return Object.fromEntries(
        PROXY_HTTP_SETTINGS.flatMap(({ key }) => {
            const value = settings[key]
            return value === undefined ? [] : [[key, value]]
        }),
    )
}

export function parseProxyHttpSettings(source: string): ProxyHttpSettings {
    if (source.length > MAX_PROXY_SETTINGS_SOURCE_LENGTH) {
        throw new ProxyHttpSettingsParseError(1)
    }

    const settings: Record<string, number> = {}
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
        const trimmed = line.trim()
        if (!trimmed) continue

        const match = /^([a-z_]+)[ \t]+([0-9]+)([kms]?);$/u.exec(trimmed)
        const definition = match && PROXY_HTTP_SETTINGS.find((item) => item.directive === match[1])
        if (!match || !definition || Object.hasOwn(settings, definition.key)) {
            throw new ProxyHttpSettingsParseError(index + 1)
        }

        const suffix = match[3]
        if (
            (definition.unit === 'seconds' && suffix !== 's') ||
            (definition.unit === 'bytes' && suffix === 's')
        ) {
            throw new ProxyHttpSettingsParseError(index + 1)
        }

        const multiplier = suffix === 'm' ? 1_048_576 : suffix === 'k' ? 1_024 : 1
        const value = Number(match[2]) * multiplier
        if (
            !Number.isSafeInteger(value) ||
            value < definition.minimum ||
            value > definition.maximum
        ) {
            throw new ProxyHttpSettingsParseError(index + 1)
        }
        settings[definition.key] = value
    }

    return normalizeProxyHttpSettings(settings)
}

export function formatProxyHttpSettings(settings: ProxyHttpSettings): string {
    return PROXY_HTTP_SETTINGS.flatMap(({ key, directive, unit }) => {
        const value = settings[key]
        if (value === undefined) return []
        const formatted =
            unit === 'seconds'
                ? `${value}s`
                : value % 1_048_576 === 0
                  ? `${value / 1_048_576}m`
                  : value % 1_024 === 0
                    ? `${value / 1_024}k`
                    : String(value)
        return [`${directive} ${formatted};`]
    }).join('\n')
}

export const proxyHostConfigEditorIdSchema = z.strictObject({
    proxyHostId: z.uuid().transform((value) => value.toLowerCase()),
})

export const proxyHostConfigEditorSaveSchema = proxyConfigEditorSaveSchema.extend({
    ...proxyHostConfigEditorIdSchema.shape,
    advancedConfig: proxyAdvancedConfigSchema.optional(),
})

export const proxyHostConfigEditorResetSchema = proxyConfigEditorResetSchema.extend({
    ...proxyHostConfigEditorIdSchema.shape,
    resetAdvancedConfig: z.boolean().optional(),
})

export const proxyHostConfigEditorPreviewSchema = proxyHostConfigEditorIdSchema.extend({
    settingsSource: z.string().max(MAX_PROXY_SETTINGS_SOURCE_LENGTH),
    advancedConfig: proxyAdvancedConfigSchema.optional(),
})
