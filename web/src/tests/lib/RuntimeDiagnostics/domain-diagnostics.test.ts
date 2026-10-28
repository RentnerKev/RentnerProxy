import { expect, test } from 'bun:test'
import {
    domainDiagnosticsInputSchema,
    domainDiagnosticsResultSchema,
} from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
    diagnosticRevision,
} from './domain-diagnostics.fixture.ts'

test('input accepts only canonical configured DNS selectors, including wildcard, never probe targets', () => {
    expect(domainDiagnosticsInputSchema.parse(domainDiagnosticsInput)).toEqual(
        domainDiagnosticsInput,
    )
    expect(
        domainDiagnosticsInputSchema.safeParse({
            ...domainDiagnosticsInput,
            domain: '*.example.com',
        }).success,
    ).toBeTrue()
    for (const domain of [
        'https://example.com',
        '192.0.2.1',
        '[::1]',
        'APP.example.com',
        'example.com.',
        'example.com/path',
        'user@example.com',
        '*.*.example.com',
    ])
        expect(
            domainDiagnosticsInputSchema.safeParse({ ...domainDiagnosticsInput, domain }).success,
        ).toBeFalse()
    for (const extra of [
        { target: '127.0.0.1' },
        { expectedRevision: diagnosticRevision },
        { credentials: 'secret' },
    ])
        expect(
            domainDiagnosticsInputSchema.safeParse({ ...domainDiagnosticsInput, ...extra }).success,
        ).toBeFalse()
})

test('response schema rejects private data, false positive states, cross-stage fields and invalid HTTP classification', () => {
    const fixture = domainDiagnosticsFixture()
    expect(domainDiagnosticsResultSchema.safeParse(fixture).success).toBeTrue()
    const invalid = [
        { ...fixture, pem: 'PRIVATE' },
        { ...fixture, activeRevision: null },
        { ...fixture, publicReachability: 'passed' },
        { ...fixture, checkedAt: '2026-10-28T10:00:00+01:00' },
        {
            ...fixture,
            stages: { ...fixture.stages, tls: { ...fixture.stages.tls, credentials: 'PRIVATE' } },
        },
        {
            ...fixture,
            stages: {
                ...fixture.stages,
                upstream: { ...fixture.stages.upstream, addresses: ['127.0.0.1'] },
            },
        },
        {
            ...fixture,
            stages: { ...fixture.stages, dns: { ...fixture.stages.dns, addresses: ['not-an-ip'] } },
        },
        {
            ...fixture,
            stages: { ...fixture.stages, dns: { ...fixture.stages.dns, addresses: [] } },
        },
        {
            ...fixture,
            stages: {
                ...fixture.stages,
                upstream: { ...fixture.stages.upstream, httpStatus: 503 },
            },
        },
        {
            ...fixture,
            stages: { ...fixture.stages, tls: { ...fixture.stages.tls, status: 'unknown' } },
        },
        {
            ...fixture,
            stages: {
                ...fixture.stages,
                configuration: { ...fixture.stages.configuration, durationMs: 12_001 },
            },
        },
        { ...fixture, hostType: 'redirect' },
        { ...fixture, domain: '*.example.com' },
    ]
    for (const value of invalid)
        expect(domainDiagnosticsResultSchema.safeParse(value).success).toBeFalse()
})

test.each([
    [302, 'unknown', 'redirect_not_followed'],
    [401, 'failed', 'access_denied'],
    [403, 'failed', 'access_denied'],
    [503, 'failed', 'upstream_error'],
    [404, 'unknown', 'unexpected_status'],
    [101, 'unknown', 'unexpected_status'],
] as const)('HTTP %s keeps its precise safe diagnostic meaning', (httpStatus, status, code) => {
    const fixture = domainDiagnosticsFixture()
    expect(
        domainDiagnosticsResultSchema.safeParse({
            ...fixture,
            stages: {
                ...fixture.stages,
                upstream: { ...fixture.stages.upstream, status, code, httpStatus },
            },
        }).success,
    ).toBeTrue()
})
