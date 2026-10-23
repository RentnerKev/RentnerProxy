import { describe, expect, test } from 'bun:test'
import { normalizeProxyHttpSettings } from '@/features/Admin/ProxyHostManagement/config-validation.ts'
import { createProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'

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

test('compression is additive in v7, retained in desired state and included in the revision', () => {
    const initial = createProxyRuntimeSnapshot([host()])
    const automatic = createProxyRuntimeSnapshot([host()], { responseCompression: 'auto' })
    const override = createProxyRuntimeSnapshot(
        [host({ httpSettings: { responseCompression: 'off' } })],
        { responseCompression: 'auto' },
    )
    expect(automatic.httpSettings).toEqual({ responseCompression: 'auto' })
    expect(override.proxyHosts[0]?.httpSettings).toEqual({ responseCompression: 'off' })
    expect(automatic.revision).not.toBe(initial.revision)
    expect(override.revision).not.toBe(automatic.revision)
    expect(createProxyRuntimeSnapshot([host()])).toEqual(initial)
})
