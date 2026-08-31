import { describe, expect, test } from 'bun:test'

import { PERMISSION_REGISTRY, SYSTEM_ROLE_REGISTRY } from '../config/permissions.config'
import {
    normalizeForwardHost,
    normalizeUpstreamTlsServerName,
} from '../features/Admin/ProxyHostManagement/Helpers/proxyHostValidation'
import { normalizeUpstreamTlsSettings } from '../server/Admin/ProxyHostManagement/upstream-tls.service'
import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
    ProxyRuntimeTrustedCa,
    ProxyRuntimeUpstreamTls,
} from '../server/ProxyRuntime/Types/proxy-runtime.types'
import type { ProxyHostForwardScheme } from '../config/proxy-hosts.config'

const BASE_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const SECOND_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54020'
const CA_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54021'
const CA_FINGERPRINT = 'sha256:' + 'a'.repeat(64)
const CA_PEM = '-----BEGIN CERTIFICATE-----\nfixture-public-ca-one\n-----END CERTIFICATE-----'
const CA_ONE: ProxyRuntimeTrustedCa = {
    id: CA_ID,
    pem: CA_PEM,
    fingerprintSha256: CA_FINGERPRINT,
}

type FormInput = {
    readonly domains: string[]
    readonly forwardScheme: ProxyHostForwardScheme
    readonly forwardHost: string
    readonly forwardPort: number
    readonly enabled: boolean
    readonly verifyUpstreamTls?: boolean
    readonly upstreamTlsServerName?: string | null
    readonly trustedCaId?: string | null
}
type ExistingTls = {
    readonly forwardScheme: ProxyHostForwardScheme
    readonly verifyUpstreamTls: boolean
    readonly upstreamTlsServerName: string | null
    readonly trustedCaId: string | null
}
type NormalizedTls = Omit<ExistingTls, 'forwardScheme'>
type SnapshotInputHost = ProxyRuntimeHost & {
    readonly enabled: boolean
    readonly upstreamTls?: ProxyRuntimeUpstreamTls | undefined
}
type SnapshotBuilder = (
    hosts: ReadonlyArray<SnapshotInputHost>,
    httpSettings?: Record<string, number>,
    trustedCas?: ReadonlyArray<ProxyRuntimeTrustedCa>,
) => ProxyRuntimeSnapshot

const buildSnapshot: SnapshotBuilder = createProxyRuntimeSnapshot
const normalizeTls: (input: FormInput, existing?: ExistingTls) => NormalizedTls =
    normalizeUpstreamTlsSettings

function formInput(overrides: Partial<FormInput> = {}): FormInput {
    return {
        domains: ['proxy.test'],
        forwardScheme: 'https',
        forwardHost: 'backend.example',
        forwardPort: 8443,
        enabled: true,
        ...overrides,
    }
}

function host(overrides: Partial<SnapshotInputHost> = {}): SnapshotInputHost {
    return {
        id: BASE_ID,
        domains: ['proxy.test'],
        enabled: true,
        forwardScheme: 'https',
        forwardHost: 'backend.example',
        forwardPort: 8443,
        upstreamTls: {
            verify: true,
            serverName: 'backend.example',
            trustedCaId: null,
        },
        ...overrides,
    }
}

function snapshot(
    hosts: ReadonlyArray<SnapshotInputHost> = [host()],
    trustedCas: ReadonlyArray<ProxyRuntimeTrustedCa> = [],
): ProxyRuntimeSnapshot {
    return buildSnapshot(hosts, {}, trustedCas)
}

describe('upstream TLS form normalization', () => {
    test('defaults new HTTPS hosts to verification with automatic identity and system trust', () => {
        expect(normalizeTls(formInput())).toEqual({
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
        })
    })

    test('keeps HTTP hosts free of stale TLS settings and resets HTTP to HTTPS securely', () => {
        expect(
            normalizeTls(
                formInput({
                    forwardScheme: 'http',
                    verifyUpstreamTls: false,
                    upstreamTlsServerName: 'wrong.example',
                    trustedCaId: CA_ID.toUpperCase(),
                }),
            ),
        ).toEqual({
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
        })
        expect(
            normalizeTls(formInput({ forwardScheme: 'https' }), {
                forwardScheme: 'http',
                verifyUpstreamTls: false,
                upstreamTlsServerName: 'old.example',
                trustedCaId: CA_ID,
            }),
        ).toEqual({
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
        })
    })

    test('preserves explicit HTTPS settings while scheme changes use the secure default', () => {
        expect(
            normalizeTls(formInput(), {
                forwardScheme: 'https',
                verifyUpstreamTls: false,
                upstreamTlsServerName: 'nas.internal',
                trustedCaId: null,
            }),
        ).toEqual({
            verifyUpstreamTls: false,
            upstreamTlsServerName: 'nas.internal',
            trustedCaId: null,
        })
        expect(
            normalizeTls(formInput({ forwardScheme: 'https', verifyUpstreamTls: false }), {
                forwardScheme: 'http',
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
            }).verifyUpstreamTls,
        ).toBeFalse()
    })

    test('requires a DNS identity override for verified IPv4 and IPv6 targets', () => {
        for (const forwardHost of ['192.0.2.10', '2001:db8::10']) {
            expect(() =>
                normalizeTls(formInput({ forwardHost, upstreamTlsServerName: null })),
            ).toThrow()
            expect(
                normalizeTls(formInput({ forwardHost, upstreamTlsServerName: 'backend.example' })),
            ).toMatchObject({
                verifyUpstreamTls: true,
                upstreamTlsServerName: 'backend.example',
            })
        }
    })

    test('rejects a custom CA when verification is disabled', () => {
        expect(() =>
            normalizeTls(
                formInput({
                    verifyUpstreamTls: false,
                    trustedCaId: CA_ID,
                }),
            ),
        ).toThrow()
        expect(
            normalizeTls(
                formInput({
                    verifyUpstreamTls: false,
                    trustedCaId: null,
                    upstreamTlsServerName: 'backend.example',
                }),
            ),
        ).toEqual({
            verifyUpstreamTls: false,
            upstreamTlsServerName: 'backend.example',
            trustedCaId: null,
        })
    })

    test('normalizes DNS server names and rejects URL, port, wildcard, IP, and injection forms', () => {
        expect(normalizeUpstreamTlsServerName('  Backend.Example. ')).toBe('backend.example')
        expect(normalizeForwardHost('[2001:0DB8::10]')).toBe('2001:db8::10')
        for (const value of [
            'https://backend.example',
            'backend.example:8443',
            '*.backend.example',
            '192.0.2.10',
            '2001:db8::10',
            'backend.example/path',
            'backend.example?x=1',
            'backend.example\\nproxy_pass http://evil',
            'user:password@backend.example',
        ]) {
            expect(normalizeUpstreamTlsServerName(value), value).toBeNull()
        }
    })
})

describe('upstream TLS runtime snapshots', () => {
    test('emits one canonical v5 CA bundle for multiple host references', () => {
        const result = snapshot(
            [
                host({
                    id: BASE_ID,
                    domains: ['one.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
                host({
                    id: SECOND_ID,
                    domains: ['two.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
            ],
            [CA_ONE],
        )
        expect(result.version).toBe(5)
        expect(result.trustedCas).toEqual([CA_ONE])
        expect(
            (result.proxyHosts as ReadonlyArray<SnapshotInputHost>).every(
                (entry) => entry.upstreamTls?.trustedCaId === CA_ID,
            ),
        ).toBeTrue()
    })

    test('sorts hosts, domains, and trusted CAs deterministically', () => {
        const secondCa: ProxyRuntimeTrustedCa = {
            id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
            pem: '-----BEGIN CERTIFICATE-----\nfixture-public-ca-two\n-----END CERTIFICATE-----',
            fingerprintSha256: 'sha256:' + 'b'.repeat(64),
        }
        const first = snapshot(
            [
                host({
                    id: SECOND_ID,
                    domains: ['z.test', 'a.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: secondCa.id,
                    },
                }),
                host({
                    id: BASE_ID,
                    domains: ['y.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
            ],
            [secondCa, CA_ONE],
        )
        const reordered = snapshot(
            [
                host({
                    id: BASE_ID,
                    domains: ['y.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
                host({
                    id: SECOND_ID,
                    domains: ['a.test', 'z.test'],
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: secondCa.id,
                    },
                }),
            ],
            [CA_ONE, secondCa],
        )
        expect(reordered).toEqual(first)
        expect(first.proxyHosts[0]?.domains).toEqual(['y.test'])
        expect(first.proxyHosts[1]?.domains).toEqual(['a.test', 'z.test'])
        expect(first.trustedCas?.map((entry) => entry.id)).toEqual([CA_ID, secondCa.id])
    })

    test('changes revision for verification, TLS name, and CA material changes', () => {
        const secure = snapshot()
        const insecure = snapshot([
            host({
                upstreamTls: { verify: false, serverName: 'backend.example', trustedCaId: null },
            }),
        ])
        const renamed = snapshot([
            host({ upstreamTls: { verify: true, serverName: 'other.example', trustedCaId: null } }),
        ])
        const replacedCa = snapshot(
            [
                host({
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
            ],
            [
                {
                    ...CA_ONE,
                    pem: CA_PEM.replace('one', 'replacement'),
                    fingerprintSha256: 'sha256:' + 'c'.repeat(64),
                },
            ],
        )
        expect(
            new Set([secure.revision, insecure.revision, renamed.revision, replacedCa.revision])
                .size,
        ).toBe(4)
    })

    test('rejects a missing trusted CA instead of silently downgrading verification', () => {
        expect(() =>
            snapshot([
                host({
                    upstreamTls: {
                        verify: true,
                        serverName: 'backend.example',
                        trustedCaId: CA_ID,
                    },
                }),
            ]),
        ).toThrow()
    })

    test('keeps HTTP snapshots on legacy v1 through v4 contracts', () => {
        const { upstreamTls: _upstreamTls, ...httpsFields } = host()
        const http = { ...httpsFields, forwardScheme: 'http' as const }
        expect(snapshot([http]).version).toBe(1)
        expect(buildSnapshot([http], { proxyConnectTimeoutSeconds: 10 }).version).toBe(2)
        expect(buildSnapshot([{ ...http, advancedConfig: 'return 200;' }]).version).toBe(3)
        expect(
            buildSnapshot([
                {
                    ...http,
                    certificateId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54023',
                },
            ]).version,
        ).toBe(4)
    })
})

describe('upstream TLS permission registry', () => {
    test('registers trusted CA permissions and grants owner/admin full access with viewer read access', () => {
        const trustedPermissions = [
            'trusted_cas.view',
            'trusted_cas.create',
            'trusted_cas.update',
            'trusted_cas.delete',
        ]
        const registered = PERMISSION_REGISTRY.map((permission) => permission.key)
        expect(registered).toEqual(expect.arrayContaining(trustedPermissions))
        for (const roleKey of ['owner', 'admin']) {
            const role = SYSTEM_ROLE_REGISTRY.find((entry) => entry.key === roleKey)
            expect(role?.permissionKeys).toEqual(expect.arrayContaining(trustedPermissions))
        }
        const viewer = SYSTEM_ROLE_REGISTRY.find((entry) => entry.key === 'viewer')
        expect(viewer?.permissionKeys).toContain('trusted_cas.view')
        expect(viewer?.permissionKeys).not.toContain('trusted_cas.create')
        expect(viewer?.permissionKeys).not.toContain('trusted_cas.update')
        expect(viewer?.permissionKeys).not.toContain('trusted_cas.delete')
    })
})
