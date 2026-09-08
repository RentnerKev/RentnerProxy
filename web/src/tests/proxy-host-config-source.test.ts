import { describe, expect, test } from 'bun:test'
import {
    normalizeProxyHostHttpSettings,
    proxyHostHttpSettingsSchema,
} from '../features/Admin/ProxyHostManagement/config-validation'

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
