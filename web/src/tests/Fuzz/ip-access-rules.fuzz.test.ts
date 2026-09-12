import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { createProxyRuntimeSnapshot } from '../../server/ProxyRuntime/proxy-runtime-snapshot'
import {
    accessPolicyIpRulesInputSchema,
    canonicalIpNetwork,
} from '../../shared/Helpers/ipAccessRules'

const policy = {
    id: '0198d98a-0000-7000-8000-000000000081',
    mode: 'combined' as const,
    combination: 'all' as const,
}
const host = {
    id: '0198d98a-0000-7000-8000-000000000082',
    domains: ['ip-rules.example.com'],
    enabled: true,
    forwardScheme: 'http' as const,
    forwardHost: '127.0.0.1',
    forwardPort: 8080,
}

describe('IP access rule boundary properties', () => {
    test('canonicalizes every generated IPv4 network and keeps the rule bounded', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 255 }),
                    fc.integer({ min: 0, max: 32 }),
                ),
                ([a, b, c, d, prefix]) => {
                    const input = `${a}.${b}.${c}.${d}/${prefix}`
                    const canonical = canonicalIpNetwork(input)
                    if (canonical === null) throw new Error('Generated IPv4 network was invalid.')
                    const parsed = accessPolicyIpRulesInputSchema.parse({
                        defaultAction: 'allow',
                        allow: [input],
                        deny: [],
                    })
                    expect(parsed.allow).toEqual([canonical])
                    expect(parsed.allow.length).toBeLessThanOrEqual(128)
                },
            ),
            { numRuns: 100 },
        )
    })

    test('normalizes canonical rule ordering in runtime snapshots and preserves shared definitions', () => {
        const ipRules = {
            defaultAction: 'deny' as const,
            allow: ['2001:db8::/64', '192.0.2.0/24'],
            deny: ['10.0.0.0/8'],
        }
        const first = createProxyRuntimeSnapshot([
            { ...host, accessPolicy: { ...policy, ipRules } },
        ])
        const second = createProxyRuntimeSnapshot([
            {
                ...host,
                accessPolicy: {
                    ...policy,
                    ipRules: {
                        defaultAction: 'deny' as const,
                        allow: ['192.0.2.0/24', '2001:db8::/64'],
                        deny: ['10.0.0.0/8'],
                    },
                },
            },
        ])
        expect(second).toEqual(first)
        expect(first.proxyHosts[0]?.accessPolicy?.ipRules).toEqual({
            defaultAction: 'deny',
            allow: ['192.0.2.0/24', '2001:db8::/64'],
            deny: ['10.0.0.0/8'],
        })
        expect(
            createProxyRuntimeSnapshot([
                {
                    ...host,
                    accessPolicy: {
                        ...policy,
                        mode: 'public',
                        combination: null,
                        ipRules,
                    },
                },
            ]).proxyHosts[0]?.accessPolicy,
        ).toEqual({
            id: policy.id,
            mode: 'public',
            combination: null,
            ipRules: {
                defaultAction: 'deny',
                allow: ['192.0.2.0/24', '2001:db8::/64'],
                deny: ['10.0.0.0/8'],
            },
        })
    })

    test('rejects noncanonical networks and unknown IP rule fields at the snapshot boundary', () => {
        expect(() =>
            createProxyRuntimeSnapshot([
                {
                    ...host,
                    accessPolicy: {
                        ...policy,
                        ipRules: { defaultAction: 'allow', allow: ['192.0.2.1/24'], deny: [] },
                    },
                },
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                {
                    ...host,
                    accessPolicy: {
                        ...policy,
                        ipRules: {
                            defaultAction: 'allow',
                            allow: ['192.0.2.0/24'],
                            deny: [],
                            provider: 'unexpected',
                        } as never,
                    },
                },
            ]),
        ).toThrow()
    })
})
