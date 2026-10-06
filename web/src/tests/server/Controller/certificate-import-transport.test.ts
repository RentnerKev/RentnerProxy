import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { importControllerCertificate } from '@/server/Controller/certificates.server.ts'

const controllerVariables = [
    'RENTNERPROXY_CONTROLLER_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'RENTNERPROXY_CONTROLLER_TOKEN_FILE',
] as const
const originalEnvironment = new Map(
    controllerVariables.map((variable) => [variable, process.env[variable]]),
)
const certificateId = '0198d98a-0000-7000-8000-000000000001'
const importInput = { certificatePem: 'certificate-fixture', privateKeyPem: 'fixture' }
const domains = ['certificate.example.test']
const metadata = {
    id: certificateId,
    source: 'manual',
    environment: null,
    domains,
    status: 'valid',
    operation: 'idle',
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
    issuer: null,
    fingerprint: `sha256:${'0'.repeat(64)}`,
    lastErrorCode: null,
    updatedAt: '2026-10-06T00:00:00Z',
}
const requests: Array<{ url: string; options: RequestInit | undefined }> = []
let fetchSpy: { mockRestore(): void } | undefined

beforeEach(() => {
    requests.length = 0
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'D'.repeat(32)
    delete process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: RequestInfo | URL, options?: RequestInit) => {
                requests.push({ url: String(input), options })
                return Response.json(metadata)
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
})

afterEach(() => {
    fetchSpy?.mockRestore()
    for (const variable of controllerVariables) {
        const original = originalEnvironment.get(variable)
        if (original === undefined) delete process.env[variable]
        else process.env[variable] = original
    }
})

describe('certificate import controller transport', () => {
    test.each([
        'http://192.0.2.10:8081',
        'http://controller.example.test:8081',
        'http://[2001:db8::10]:8081',
    ])('rejects non-confidential transport before dispatch: %s', async (url) => {
        process.env.RENTNERPROXY_CONTROLLER_URL = url

        await expect(
            importControllerCertificate(certificateId, importInput, domains),
        ).rejects.toMatchObject({ code: 'controller_unavailable' })
        expect(requests).toHaveLength(0)
    })

    test.each([
        'https://controller.example.test:8443',
        'http://127.0.0.1:8081',
        'http://localhost:8081',
        'http://[::1]:8081',
    ])('allows authenticated supported transport: %s', async (url) => {
        process.env.RENTNERPROXY_CONTROLLER_URL = url

        await expect(
            importControllerCertificate(certificateId, importInput, domains),
        ).resolves.toMatchObject(metadata)
        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request?.url).toBe(`${url}/internal/v1/certificates/${certificateId}/import`)
        expect(request?.options?.method).toBe('POST')
        expect(request?.options?.redirect).toBe('error')
        expect(new Headers(request?.options?.headers).get('authorization')).toBe(
            `Bearer ${'D'.repeat(32)}`,
        )
        expect(JSON.parse(String(request?.options?.body))).toEqual({
            ...importInput,
            requiredDomains: domains,
        })
    })

    test.each(['https://controller.example.test:8443', 'http://127.0.0.1:8081'])(
        'requires controller authentication for imports: %s',
        async (url) => {
            process.env.RENTNERPROXY_CONTROLLER_URL = url
            process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''

            await expect(
                importControllerCertificate(certificateId, importInput, domains),
            ).rejects.toMatchObject({ code: 'controller_unavailable' })
            expect(requests).toHaveLength(0)
        },
    )
})
