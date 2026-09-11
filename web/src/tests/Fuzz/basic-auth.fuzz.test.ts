import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { createProxyRuntimeSnapshot } from '../../server/ProxyRuntime/proxy-runtime-snapshot'

const passwordHash =
    '$argon2id$v=19$m=47104,t=1,p=1$D9DZswB3sd8X+q53At5IZzE66kfAyW2EfQqDXkM0qT4$OFdQErjb/mhjjC+Aw2O+S44+7YG8EMj7KM1/LIbk7gY'
const host = {
    id: '0198d98a-0000-7000-8000-000000000081',
    domains: ['auth.example.com'],
    enabled: true,
    forwardScheme: 'http' as const,
    forwardHost: '127.0.0.1',
    forwardPort: 8080,
}
const policy = {
    id: '0198d98a-0000-7000-8000-000000000082',
    mode: 'authenticated' as const,
    combination: null,
}

describe('Basic Auth snapshot boundary properties', () => {
    test('matches the controller Basic Auth revision vector', () => {
        const snapshot = createProxyRuntimeSnapshot([
            {
                ...host,
                id: '018f4b4a-7d1f-7abc-8def-0123456789ab',
                domains: ['a.example'],
                accessPolicy: {
                    ...policy,
                    id: '0198d98a-0000-7000-8000-000000000001',
                    basicAuth: {
                        accounts: [
                            {
                                username: 'alice',
                                passwordHash:
                                    '$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$MrQeoLQVkaRjr94luEbHZECFRREjHzNciGTu9rBCN+Y',
                            },
                        ],
                    },
                },
            },
        ])
        expect(snapshot.revision).toBe(
            'sha256:6a76f1e090fa29f7223b382e03c073ee3f1b04fc016273c8de9acea17f71e78c',
        )
    })
    test('rejects noncanonical base64 and Caddy placeholders in account data', () => {
        for (const account of [
            { username: 'alice', passwordHash: passwordHash.replace('M0qT4$', 'M0qT5$') },
            { username: '{env.USER}', passwordHash },
            { username: 'alice:admin', passwordHash },
        ]) {
            expect(() =>
                createProxyRuntimeSnapshot([
                    { ...host, accessPolicy: { ...policy, basicAuth: { accounts: [account] } } },
                ]),
            ).toThrow()
        }
    })
    test('canonicalizes account ordering and preserves legacy omission', () => {
        fc.assert(
            fc.property(
                fc.shuffledSubarray(['alice', 'bob', 'carol'], { minLength: 3, maxLength: 3 }),
                (names) => {
                    const accounts = names.map((username) => ({ username, passwordHash }))
                    const snapshot = createProxyRuntimeSnapshot([
                        { ...host, accessPolicy: { ...policy, basicAuth: { accounts } } },
                    ])
                    const sorted = createProxyRuntimeSnapshot([
                        {
                            ...host,
                            accessPolicy: {
                                ...policy,
                                basicAuth: {
                                    accounts: accounts.toSorted((a, b) =>
                                        a.username.localeCompare(b.username),
                                    ),
                                },
                            },
                        },
                    ])
                    expect(snapshot).toEqual(sorted)
                    expect(snapshot.revision).not.toBe(
                        createProxyRuntimeSnapshot([{ ...host, accessPolicy: policy }]).revision,
                    )
                    expect(
                        createProxyRuntimeSnapshot([
                            { ...host, accessPolicy: { ...policy, basicAuth: undefined } },
                        ]),
                    ).toEqual(createProxyRuntimeSnapshot([{ ...host, accessPolicy: policy }]))
                },
            ),
            { numRuns: 25 },
        )
    })

    test('rejects attacker-selected algorithms and provider options', () => {
        fc.assert(
            fc.property(
                fc.string({ maxLength: 24 }),
                fc.jsonValue({ maxDepth: 2 }),
                (key, value) => {
                    const basicAuth = {
                        accounts: [{ username: 'alice', passwordHash }],
                        ['unsupported_' + key]: value,
                    }
                    expect(() =>
                        createProxyRuntimeSnapshot([
                            { ...host, accessPolicy: { ...policy, basicAuth } },
                        ]),
                    ).toThrow()
                },
            ),
            { numRuns: 100 },
        )
    })

    test('rejects unbounded or weakened Argon2 parameters', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 2_147_483_647 }).filter((memory) => memory !== 47104),
                (memory) => {
                    const invalidHash = passwordHash.replace('m=47104', 'm=' + memory)
                    expect(() =>
                        createProxyRuntimeSnapshot([
                            {
                                ...host,
                                accessPolicy: {
                                    ...policy,
                                    basicAuth: {
                                        accounts: [
                                            { username: 'alice', passwordHash: invalidHash },
                                        ],
                                    },
                                },
                            },
                        ]),
                    ).toThrow()
                },
            ),
            { numRuns: 100 },
        )
    })

    test('rejects duplicate usernames and inconsistent credentials for a shared policy', () => {
        const basicAuth = { accounts: [{ username: 'alice', passwordHash }] }
        expect(() =>
            createProxyRuntimeSnapshot([
                {
                    ...host,
                    accessPolicy: {
                        ...policy,
                        basicAuth: { accounts: [...basicAuth.accounts, ...basicAuth.accounts] },
                    },
                },
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                { ...host, accessPolicy: { ...policy, basicAuth } },
                {
                    ...host,
                    id: '0198d98a-0000-7000-8000-000000000083',
                    domains: ['other.example.com'],
                    accessPolicy: {
                        ...policy,
                        basicAuth: { accounts: [{ username: 'bob', passwordHash }] },
                    },
                },
            ]),
        ).toThrow()
    })
})
