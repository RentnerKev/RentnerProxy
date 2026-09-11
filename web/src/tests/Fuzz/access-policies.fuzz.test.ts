import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { ACCESS_POLICY_MODES } from '../../config/access-policies.config'
import { createAccessPolicyInputSchema } from '../../features/Admin/AccessPolicyManagement/validation'
import { createProxyRuntimeSnapshot } from '../../server/ProxyRuntime/proxy-runtime-snapshot'

const policyId = '0198d98a-0000-7000-8000-000000000071'
const host = {
    id: '0198d98a-0000-7000-8000-000000000072',
    domains: ['policy.example.com'],
    enabled: true,
    forwardScheme: 'http' as const,
    forwardHost: '127.0.0.1',
    forwardPort: 8080,
}

describe('Access Policy boundary property tests', () => {
    test('normalizes policy IDs and rejects inconsistent shared definitions', () => {
        const policy = {
            id: '0198d98a-0000-7000-8000-0000000000ab',
            mode: 'authenticated' as const,
            combination: null,
        }
        expect(
            createProxyRuntimeSnapshot([
                { ...host, accessPolicy: { ...policy, id: policy.id.toUpperCase() } },
            ]),
        ).toEqual(createProxyRuntimeSnapshot([{ ...host, accessPolicy: policy }]))
        expect(() =>
            createProxyRuntimeSnapshot([
                { ...host, accessPolicy: policy },
                {
                    ...host,
                    id: '0198d98a-0000-7000-8000-000000000073',
                    domains: ['other.example.com'],
                    accessPolicy: { ...policy, mode: 'public' },
                },
            ]),
        ).toThrow('inconsistent access policies')
    })
    test('matches the controller v7 protected-policy revision vector', () => {
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
                    mode: 'authenticated',
                    combination: null,
                },
            },
        ])
        expect(snapshot.revision).toBe(
            'sha256:a51e0707c8c480299216f23841376ce6506b9398fce80b8ac14c4288b82649e3',
        )
    })

    test('accepts only explicit valid mode/combination pairs', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ACCESS_POLICY_MODES),
                fc.constantFrom(null, 'all', 'any'),
                (mode, combination) => {
                    const parsed = createAccessPolicyInputSchema.safeParse({
                        name: 'Policy',
                        mode,
                        combination,
                    })
                    expect(parsed.success).toBe((mode === 'combined') === (combination !== null))
                },
            ),
            { numRuns: 100 },
        )
    })

    test('never accepts arbitrary provider configuration or expressions', () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 32 }),
                fc.jsonValue({ maxDepth: 3 }),
                (key, value) => {
                    const parsed = createAccessPolicyInputSchema.safeParse({
                        name: 'Policy',
                        mode: 'public',
                        combination: null,
                        ['untrusted_' + key]: value,
                    })
                    expect(parsed.success).toBe(false)
                },
            ),
            { numRuns: 100 },
        )
    })

    test('canonicalizes policy key order without dropping protected modes from revisions', () => {
        fc.assert(
            fc.property(fc.constantFrom('all' as const, 'any' as const), (combination) => {
                const policy = { id: policyId, mode: 'combined' as const, combination }
                const first = createProxyRuntimeSnapshot([{ ...host, accessPolicy: policy }])
                const reordered = createProxyRuntimeSnapshot([
                    {
                        ...host,
                        accessPolicy: {
                            combination,
                            mode: 'combined',
                            id: policyId,
                        },
                    },
                ])
                expect(reordered).toEqual(first)
                expect(first.proxyHosts[0]?.accessPolicy).toEqual(policy)
                expect(first.revision).not.toBe(createProxyRuntimeSnapshot([host]).revision)
                expect(first.revision).not.toBe(
                    createProxyRuntimeSnapshot([
                        { ...host, accessPolicy: { ...policy, mode: 'public', combination: null } },
                    ]).revision,
                )
                expect(createProxyRuntimeSnapshot([{ ...host, accessPolicy: undefined }])).toEqual(
                    createProxyRuntimeSnapshot([host]),
                )
            }),
            { numRuns: 50 },
        )
    })
})
