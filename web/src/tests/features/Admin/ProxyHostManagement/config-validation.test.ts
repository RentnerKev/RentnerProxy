import { describe, expect, test } from 'bun:test'
import {
    normalizeProxyHostHttpSettings,
    proxyHostHttpSettingsSchema,
} from '@/features/Admin/ProxyHostManagement/config-validation.ts'

describe('Caddy structured host settings', () => {
    test('accepts four supported per-host settings in canonical order', () => {
        const value = normalizeProxyHostHttpSettings({
            proxySendTimeoutSeconds: 30,
            proxyReadTimeoutSeconds: 120,
            proxyConnectTimeoutSeconds: 10,
            clientMaxBodySizeBytes: 1024,
        })
        expect(Object.keys(value)).toEqual([
            'clientMaxBodySizeBytes',
            'proxyConnectTimeoutSeconds',
            'proxyReadTimeoutSeconds',
            'proxySendTimeoutSeconds',
        ])
    })
    test('rejects unsupported per-host idle and write timeout fields', () => {
        expect(
            proxyHostHttpSettingsSchema.safeParse({ sendTimeoutSeconds: 10 }).success,
        ).toBeFalse()
        expect(
            proxyHostHttpSettingsSchema.safeParse({ keepaliveTimeoutSeconds: 10 }).success,
        ).toBeFalse()
    })
})

describe('response compression settings', () => {
    test('preserves explicit automatic and upstream-only overrides and an empty inheritance reset', () => {
        expect(normalizeProxyHostHttpSettings({ responseCompression: 'auto' })).toEqual({
            responseCompression: 'auto',
        })
        expect(normalizeProxyHostHttpSettings({ responseCompression: 'off' })).toEqual({
            responseCompression: 'off',
        })
        expect(normalizeProxyHostHttpSettings({})).toEqual({})
    })
    test('rejects arbitrary encoder names, null, and a persisted inherit sentinel', () => {
        for (const responseCompression of ['gzip', 'zstd', 'inherit', '', null, true, 1, {}])
            expect(
                proxyHostHttpSettingsSchema.safeParse({ responseCompression }).success,
            ).toBeFalse()
    })
})
