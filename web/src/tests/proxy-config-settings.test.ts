import { describe, expect, test } from 'bun:test'
import { normalizeProxyHttpSettings } from '../features/Admin/ProxyHostManagement/config-validation'
import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'

const id = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const host = (overrides: Record<string, unknown> = {}) => ({
    id,
    domains: ['demo.test'],
    enabled: true,
    forwardScheme: 'http' as const,
    forwardHost: 'backend.internal',
    forwardPort: 4000,
    ...overrides,
})

describe('Caddy structured runtime settings', () => {
    test('normalizes shared settings in the canonical field order', () => {
        const settings = normalizeProxyHttpSettings({
            keepaliveTimeoutSeconds: 75,
            sendTimeoutSeconds: 30,
            proxyReadTimeoutSeconds: 120,
        })
        expect(settings).toEqual({
            proxyReadTimeoutSeconds: 120,
            sendTimeoutSeconds: 30,
            keepaliveTimeoutSeconds: 75,
        })
    })
    test('always emits v7 with fixed top-level key order and no legacy raw config', () => {
        const result = createProxyRuntimeSnapshot([host()])
        expect(result.version).toBe(7)
        expect(Object.keys(result).slice(0, -1)).toEqual([
            'version',
            'proxyHosts',
            'redirectHosts',
            'httpSettings',
            'trustedCas',
        ])
        expect(result.redirectHosts).toEqual([])
        expect(result.httpSettings).toEqual({})
        expect(result.trustedCas).toEqual([])
        expect(JSON.stringify(result)).not.toContain('advancedConfig')
    })
    test('keeps deterministic output across input ordering', () => {
        const first = createProxyRuntimeSnapshot(
            [host({ domains: ['z.demo.test', 'demo.test'] })],
            { sendTimeoutSeconds: 30 },
        )
        const second = createProxyRuntimeSnapshot(
            [host({ domains: ['demo.test', 'z.demo.test'] })],
            { sendTimeoutSeconds: 30 },
        )
        expect(second).toEqual(first)
    })
})
