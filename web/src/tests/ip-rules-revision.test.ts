import { expect, test } from 'bun:test'

import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'

test('matches the controller IPv4/IPv6 policy revision vector', () => {
    const snapshot = createProxyRuntimeSnapshot([
        {
            id: '018f4b4a-7d1f-7abc-8def-0123456789ab',
            domains: ['a.example'],
            enabled: true,
            forwardScheme: 'http',
            forwardHost: '127.0.0.1',
            forwardPort: 8080,
            accessPolicy: {
                id: '0198d98a-0000-7000-8000-000000000001',
                mode: 'ip-restricted',
                combination: null,
                ipRules: {
                    defaultAction: 'deny',
                    allow: ['192.0.2.0/24', '2001:db8::/32'],
                    deny: ['192.0.2.128/25'],
                },
            },
        },
    ])
    expect(snapshot.revision).toBe(
        'sha256:8fa5877490619b64e54a3a549e1e6638ca0f7766ac05455262ff15721ea4db49',
    )
})
