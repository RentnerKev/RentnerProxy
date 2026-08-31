import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
    MAX_CERTIFICATE_PEM_LENGTH,
    MAX_PRIVATE_KEY_PEM_LENGTH,
} from '../config/certificates.config'
import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
} from '../config/permissions.config'
import {
    certificateCoversDomains,
    getCertificateStatus,
    isPublicAcmeDomain,
    normalizeCertificateDomain,
} from '../features/Admin/CertificateManagement/Helpers/certificateValidation'
import {
    importCertificateInputSchema,
    requestCertificateInputSchema,
} from '../features/Admin/CertificateManagement/validation'
import {
    createProxyHostInputSchema,
    updateProxyHostInputSchema,
} from '../features/Admin/ProxyHostManagement/validation'
import {
    getControllerCertificate,
    getControllerCertificates,
    importControllerCertificate,
    deleteControllerCertificate,
} from '../server/Foundation/certificates.server'
import { CertificateDomainError } from '../server/Admin/CertificateManagement/certificates.errors'
import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'

const CERTIFICATE_ID = '0198d98a-0000-7000-8000-000000000001'
const HOST_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const originalEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)
let fetchSpy: { mockRestore(): void } | undefined
let warningSpy: { mockRestore(): void } | undefined

function metadata(overrides: Record<string, unknown> = {}) {
    return {
        id: CERTIFICATE_ID,
        source: 'manual',
        environment: null,
        domains: ['demo.test', '*.demo.test'],
        status: 'valid',
        operation: 'idle',
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2027-01-01T00:00:00Z',
        issuer: 'Local test CA',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        lastErrorCode: null,
        updatedAt: '2026-08-31T00:00:00Z',
        ...overrides,
    }
}

function mockController(
    callback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
    const spy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(callback, {
            preconnect: globalThis.fetch.preconnect,
        }),
    )
    fetchSpy = spy
    return spy
}

afterEach(() => {
    fetchSpy?.mockRestore()
    warningSpy?.mockRestore()
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('certificate validation and status', () => {
    test('normalizes names and supports only one-label wildcard coverage', () => {
        expect(normalizeCertificateDomain(' *.BÜCHER.example. ')).toBe('*.xn--bcher-kva.example')
        expect(normalizeCertificateDomain('*.*.example.com')).toBeNull()
        expect(normalizeCertificateDomain('*.127.0.0.1')).toBeNull()
        expect(certificateCoversDomains(['*.example.com'], ['www.example.com'])).toBeTrue()
        expect(certificateCoversDomains(['*.example.com'], ['example.com'])).toBeFalse()
        expect(certificateCoversDomains(['*.example.com'], ['deep.www.example.com'])).toBeFalse()
        expect(
            certificateCoversDomains(['example.com'], ['example.com', 'www.example.com']),
        ).toBeFalse()
        expect(
            certificateCoversDomains(
                ['example.com', '*.example.com'],
                ['example.com', 'www.example.com'],
            ),
        ).toBeTrue()
        expect(certificateCoversDomains(['example.com'], [])).toBeFalse()
    })

    test('rejects reserved and wildcard ACME requests without accepting arbitrary directory URLs', () => {
        for (const domain of [
            'demo.test',
            'localhost',
            'host.local',
            'host.invalid',
            '*.example.com',
            '127.0.0.1',
        ]) {
            expect(isPublicAcmeDomain(domain)).toBeFalse()
            expect(
                requestCertificateInputSchema.safeParse({
                    name: 'Example',
                    domains: [domain],
                    acceptTerms: true,
                }).success,
            ).toBeFalse()
        }
        const request = { name: 'Example', domains: ['www.example.com'], acceptTerms: true }
        expect(requestCertificateInputSchema.parse(request).environment).toBe('staging')
        expect(
            requestCertificateInputSchema.safeParse({
                ...request,
                directoryUrl: 'http://169.254.169.254',
            }).success,
        ).toBeFalse()
        expect(
            requestCertificateInputSchema.safeParse({ ...request, acceptTerms: false }).success,
        ).toBeFalse()
        expect(
            requestCertificateInputSchema.safeParse({ ...request, contactEmail: 'bad\n@mail' })
                .success,
        ).toBeFalse()
    })

    test('bounds sensitive import fields and rejects browser-controlled storage paths', () => {
        const input = { name: 'Local', certificatePem: 'certificate', privateKeyPem: 'private key' }
        expect(importCertificateInputSchema.safeParse(input).success).toBeTrue()
        expect(
            importCertificateInputSchema.safeParse({ ...input, privateKeyPath: '/tmp/key' })
                .success,
        ).toBeFalse()
        expect(
            importCertificateInputSchema.safeParse({
                ...input,
                certificatePem: 'a'.repeat(MAX_CERTIFICATE_PEM_LENGTH + 1),
            }).success,
        ).toBeFalse()
        expect(
            importCertificateInputSchema.safeParse({
                ...input,
                privateKeyPem: 'a'.repeat(MAX_PRIVATE_KEY_PEM_LENGTH + 1),
            }).success,
        ).toBeFalse()
        expect(
            importCertificateInputSchema.safeParse({ ...input, name: 'hidden\nname' }).success,
        ).toBeFalse()
    })

    test('derives expiration without persisting a moving status', () => {
        const start = new Date('2026-01-01T00:00:00Z')
        const end = new Date('2026-04-01T00:00:00Z')
        expect(getCertificateStatus('valid', start, end, Date.parse('2026-02-01T00:00:00Z'))).toBe(
            'valid',
        )
        expect(getCertificateStatus('valid', start, end, Date.parse('2026-03-15T00:00:00Z'))).toBe(
            'expiring',
        )
        expect(getCertificateStatus('valid', start, end, end.getTime())).toBe('expired')
        expect(getCertificateStatus('pending', null, null)).toBe('pending')
        expect(getCertificateStatus('failed', start, end)).toBe('failed')
    })

    test('preserves omitted assignment fields for older proxy host requests', () => {
        const input = {
            domains: ['demo.test'],
            forwardScheme: 'http',
            forwardHost: 'backend.internal',
            forwardPort: 4000,
            enabled: true,
        }
        const created = createProxyHostInputSchema.parse(input)
        const updated = updateProxyHostInputSchema.parse({ ...input, proxyHostId: HOST_ID })
        expect(created.certificateId).toBeUndefined()
        expect(updated.certificateId).toBeUndefined()
        expect(updated.forceHttps).toBeUndefined()
    })
})

describe('certificate permissions and runtime contract', () => {
    test('registers six permissions; owner/admin manage and viewer reads only', () => {
        const certificatePermissions = PERMISSION_REGISTRY.filter((item) =>
            item.key.startsWith('certificates.'),
        ).map((item) => item.key)
        expect(certificatePermissions).toHaveLength(6)
        expect(new Set(certificatePermissions).size).toBe(6)
        for (const role of SYSTEM_ROLE_REGISTRY) {
            const actual = role.permissionKeys
                .filter((key) => key.startsWith('certificates.'))
                .toSorted()
            expect(actual).toEqual(
                role.key === 'viewer'
                    ? [PERMISSIONS.CERTIFICATES_VIEW]
                    : certificatePermissions.toSorted(),
            )
        }
    })

    test('matches the shared Rust v4 vector and omits all material from snapshots', () => {
        const host = {
            id: HOST_ID,
            domains: ['www.demo.test', 'demo.test'],
            enabled: true,
            forwardScheme: 'http' as const,
            forwardHost: 'backend.internal',
            forwardPort: 4000,
            certificateId: CERTIFICATE_ID,
            forceHttps: true,
            privateKeyPem: 'not-a-real-private-key',
        }
        const snapshot = createProxyRuntimeSnapshot([host])
        expect(snapshot.version).toBe(4)
        expect(snapshot.revision).toBe(
            'sha256:60ef13937bd04f3c5636c01b13c37431192b04fa7c9ba277e2dd4d89afe9c279',
        )
        expect(JSON.stringify(snapshot)).not.toContain('privateKey')
        expect(JSON.stringify(snapshot)).not.toContain('not-a-real-private-key')
        expect(
            createProxyRuntimeSnapshot([{ ...host, forceHttps: false }]).proxyHosts[0],
        ).not.toHaveProperty('forceHttps')
        expect(() => createProxyRuntimeSnapshot([{ ...host, certificateId: null }])).toThrow()
        expect(
            createProxyRuntimeSnapshot([{ ...host, certificateId: null, forceHttps: false }])
                .version,
        ).toBe(1)
    })
})

describe('sensitive controller certificate transport', () => {
    test.each([undefined, '', 'too-short'])(
        'refuses loopback certificate reads and PEM upload before fetch with token %p',
        async (token) => {
            const requests = mockController(async () => Response.json(metadata()))
            if (token === undefined) delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
            else process.env.RENTNERPROXY_CONTROLLER_TOKEN = token

            await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
                code: 'controller_unavailable',
            })
            await expect(getControllerCertificates()).rejects.toMatchObject({
                code: 'controller_unavailable',
            })
            await expect(
                importControllerCertificate(
                    CERTIFICATE_ID,
                    { certificatePem: 'explicit-test-cert', privateKeyPem: 'explicit-test-key' },
                    ['demo.test'],
                ),
            ).rejects.toMatchObject({ code: 'controller_unavailable' })
            expect(requests).not.toHaveBeenCalled()
        },
    )

    test('authenticates once-only PEM import and strips secrets from returned metadata', async () => {
        const input = {
            name: 'Local',
            certificatePem: 'explicit-test-cert',
            privateKeyPem: 'explicit-test-key',
        }
        const requests: Array<{ input: string; init: RequestInit | undefined }> = []
        mockController(async (url, init) => {
            requests.push({ input: String(url), init })
            return Response.json(
                metadata({
                    privateKeyPem: 'injected-private-key',
                    certificatePath: '/private/store',
                }),
            )
        })
        const result = await importControllerCertificate(CERTIFICATE_ID, input, ['demo.test'])
        expect(requests[0]?.input).toBe(
            'http://127.0.0.1:18081/internal/v1/certificates/' + CERTIFICATE_ID + '/import',
        )
        expect(requests[0]?.init?.method).toBe('POST')
        expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe(
            'Bearer ' + 'a'.repeat(64),
        )
        expect(requests[0]?.init?.redirect).toBe('error')
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            certificatePem: input.certificatePem,
            privateKeyPem: input.privateKeyPem,
            requiredDomains: ['demo.test'],
        })
        expect(result).not.toHaveProperty('privateKeyPem')
        expect(result).not.toHaveProperty('certificatePath')
    })

    test('rejects traversal and non-loopback access without a valid token before fetch', async () => {
        const requests = mockController(async () => Response.json(metadata()))
        await expect(getControllerCertificate('../keys')).rejects.toBeInstanceOf(
            CertificateDomainError,
        )
        process.env.RENTNERPROXY_CONTROLLER_URL = 'https://controller.example.com'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toBeInstanceOf(
            CertificateDomainError,
        )
        expect(requests).not.toHaveBeenCalled()
    })

    test('only exposes allowlisted error codes; never accepts success metadata in HTTP errors', async () => {
        const warnings: string[] = []
        warningSpy = spyOn(console, 'warn').mockImplementation((...args) => {
            warnings.push(JSON.stringify(args))
        })
        mockController(async () =>
            Response.json(
                { error: 'key_mismatch', privateKeyPem: 'secret-marker' },
                { status: 422 },
            ),
        )
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
            code: 'key_mismatch',
        })
        fetchSpy?.mockRestore()
        mockController(async () => Response.json(metadata(), { status: 403 }))
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
        fetchSpy?.mockRestore()
        mockController(async () => Response.json({ error: 'secret-marker' }, { status: 500 }))
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
        expect(warnings.join('')).not.toContain('secret-marker')
    })

    test('rejects mismatched IDs, invalid metadata, and oversized listing responses', async () => {
        mockController(async () =>
            Response.json(metadata({ id: '0198d98a-0000-7000-8000-000000000002' })),
        )
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
        fetchSpy?.mockRestore()
        mockController(async () => Response.json(metadata({ expiresAt: 'not-a-date' })))
        await expect(getControllerCertificate(CERTIFICATE_ID)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
        fetchSpy?.mockRestore()
        mockController(async () =>
            Response.json({ certificates: [], padding: 'x'.repeat(8 * 1024 * 1024) }),
        )
        await expect(getControllerCertificates()).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
    })

    test('permits a safe idempotent delete retry after remote success and a local failure', async () => {
        mockController(async () =>
            Response.json({ error: 'certificate_not_found' }, { status: 404 }),
        )
        await expect(deleteControllerCertificate(CERTIFICATE_ID)).resolves.toBeUndefined()
    })
})
