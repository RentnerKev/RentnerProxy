import { afterEach, expect, spyOn, test } from 'bun:test'
import {
    actOnControllerManualDns,
    issueControllerCertificate,
} from '@/server/Controller/certificates.server.ts'
import {
    certificateMetadataSchema,
    certificateEventPageSchema,
} from '@/server/Controller/certificates.validation.ts'

const operationId = '0198d98a-0000-7000-8000-000000000002'
const expiresAt = '2026-10-25T11:00:00Z'
const records = [
    {
        identifier: 'example.com',
        owner: '_acme-challenge.example.com',
        value: 'a'.repeat(43),
        expiresAt,
    },
    {
        identifier: '*.example.com',
        owner: '_acme-challenge.example.com',
        value: 'b'.repeat(43),
        expiresAt,
    },
]
const manualDns = {
    challengeSetId: '0198d98a-0000-7000-8000-000000000003',
    status: 'awaiting_input',
    expiresAt,
    records,
    lastCheckedAt: null,
    lastErrorCode: null,
}
const metadata = {
    id: '0198d98a-0000-7000-8000-000000000001',
    source: 'acme',
    environment: 'production',
    domains: ['example.com', '*.example.com'],
    status: 'pending',
    operation: 'issuing',
    issuedAt: null,
    expiresAt: null,
    issuer: null,
    fingerprint: null,
    lastErrorCode: null,
    updatedAt: expiresAt,
    currentOperation: {
        id: operationId,
        kind: 'issue',
        stage: 'awaiting_dns',
        startedAt: expiresAt,
        updatedAt: expiresAt,
        dnsMode: 'manual',
        manualDns,
    },
}

test('metadata preserves every manual DNS value and accepts older operation shapes', () => {
    expect(certificateMetadataSchema.parse(metadata).currentOperation?.manualDns?.records).toEqual(
        records,
    )
    const { dnsMode: _mode, manualDns: _manual, ...oldOperation } = metadata.currentOperation
    expect(
        certificateMetadataSchema.safeParse({ ...metadata, currentOperation: oldOperation })
            .success,
    ).toBeTrue()
})

test.each([
    { ...manualDns, accountKey: 'not-public' },
    { ...manualDns, records: [{ ...records[0], pem: 'not-public' }] },
    { ...manualDns, records: [{ ...records[0], value: 'https://example.com/private' }] },
    { ...manualDns, records: [{ ...records[0], owner: '_acme-challenge.other.example.com' }] },
    { ...manualDns, challengeSetId: 'not-a-uuid' },
])('rejects malformed or secret-bearing manual metadata', (value) => {
    expect(
        certificateMetadataSchema.safeParse({
            ...metadata,
            currentOperation: { ...metadata.currentOperation, manualDns: value },
        }).success,
    ).toBeFalse()
})

test.each(['operator_action_required', 'cancelled', 'expired'])(
    'accepts %s events with manual stages',
    (kind) => {
        expect(
            certificateEventPageSchema.safeParse({
                events: [
                    {
                        id: '0198d98a-0000-7000-8000-000000000004',
                        operationId,
                        certificateId: metadata.id,
                        kind,
                        stage: 'awaiting_dns',
                        occurredAt: expiresAt,
                        errorCode: null,
                    },
                ],
                nextCursor: '0198d98a-0000-7000-8000-000000000005:1',
                hasMore: false,
                resetRequired: false,
            }).success,
        ).toBeTrue()
    },
)

const controllerKeys = [
    'RENTNERPROXY_CONTROLLER_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'RENTNERPROXY_CONTROLLER_TOKEN_FILE',
] as const
const originalEnvironment = new Map(controllerKeys.map((key) => [key, process.env[key]]))
let fetchSpy: { mockRestore(): void } | undefined
afterEach(() => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined
    for (const key of controllerKeys) {
        const value = originalEnvironment.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

function mockControllerResponse(
    payload: unknown,
    status: number,
    requests: { url: string; options?: RequestInit | undefined }[],
) {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
    delete process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: RequestInfo | URL, options?: RequestInit) => {
                requests.push({ url: String(input), options })
                return Response.json(payload, { status })
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
}

test.each([
    ['continue', 202],
    ['cancel', 200],
] as const)(
    'manual DNS %s transport uses fenced IDs and parses metadata',
    async (action, status) => {
        const requests: { url: string; options?: RequestInit | undefined }[] = []
        mockControllerResponse(metadata, status, requests)
        await expect(
            actOnControllerManualDns(metadata.id, action, {
                operationId,
                challengeSetId: manualDns.challengeSetId,
            }),
        ).resolves.toMatchObject({ currentOperation: { manualDns: { records } } })
        expect(requests).toHaveLength(1)
        expect(requests[0]?.url).toEndWith(`/certificates/${metadata.id}/dns-01/${action}`)
        expect(requests[0]?.options?.method).toBe('POST')
        expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
            operationId,
            challengeSetId: manualDns.challengeSetId,
        })
    },
)

test('manual DNS transport preserves actionable stale conflict errors', async () => {
    mockControllerResponse({ error: 'operation_in_progress' }, 409, [])
    await expect(
        actOnControllerManualDns(metadata.id, 'continue', {
            operationId,
            challengeSetId: manualDns.challengeSetId,
        }),
    ).rejects.toMatchObject({ code: 'operation_in_progress' })
})

test('manual issuance forwards manual mode without a provider payload', async () => {
    const requests: { url: string; options?: RequestInit | undefined }[] = []
    mockControllerResponse(metadata, 202, requests)
    await issueControllerCertificate(metadata.id, {
        name: 'Manual',
        domains: ['example.com', '*.example.com'],
        challengeType: 'dns-01',
        dnsMode: 'manual',
        acceptTerms: true,
    })
    expect(JSON.parse(String(requests[0]?.options?.body))).toEqual({
        domains: ['example.com', '*.example.com'],
        challengeType: 'dns-01',
        dnsMode: 'manual',
        environment: 'production',
        acceptTerms: true,
    })
})
