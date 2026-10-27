import { expect, test } from 'bun:test'

import {
    certificateDetailsSearchSchema,
    certificateRequestFormSchema,
    certificateRequestInputFromForm,
    requestCertificateInputSchema,
} from '@/features/Admin/CertificateManagement/validation.ts'
import type { CertificateRequestFormValues } from '@/features/Admin/CertificateManagement/Types/validation.types.ts'

const request: CertificateRequestFormValues = {
    name: 'Public edge',
    domains: [' edge.example.com ', '', 'www.edge.example.com', ''],
    environment: 'production',
    challengeType: 'http-01',
    dnsZoneId: '',
    dnsApiToken: '',
    contactEmail: '',
    acceptTerms: true,
}

test('normalizes editable certificate lines only when validating and submitting', () => {
    expect(certificateRequestFormSchema.safeParse(request).success).toBeTrue()
    expect(
        requestCertificateInputSchema.parse(certificateRequestInputFromForm(request)).domains,
    ).toEqual(['edge.example.com', 'www.edge.example.com'])
    expect(request.domains).toEqual([' edge.example.com ', '', 'www.edge.example.com', ''])
})

test('retains public-domain and duplicate-domain validation after line normalization', () => {
    expect(
        certificateRequestFormSchema.safeParse({ ...request, domains: ['', ' '] }).success,
    ).toBeFalse()
    expect(
        certificateRequestFormSchema.safeParse({ ...request, domains: ['localhost', ''] }).success,
    ).toBeFalse()
    expect(
        certificateRequestFormSchema.safeParse({
            ...request,
            domains: ['edge.example.com', '', ' edge.example.com ', ''],
        }).success,
    ).toBeFalse()
})

test('manual DNS needs no provider credentials and keeps duplicate-owner identifiers', () => {
    const form = {
        ...request,
        domains: ['example.com', '*.example.com'],
        challengeType: 'dns-01',
        dnsMode: 'manual',
        dnsApiToken: 'stale secret',
        dnsZoneId: 'stale zone',
    }
    const input = certificateRequestInputFromForm(form)
    expect(input).not.toHaveProperty('dnsProvider')
    expect(input).not.toHaveProperty('dnsApiToken')
    expect(input).not.toHaveProperty('dnsZoneId')
    expect(requestCertificateInputSchema.parse(input)).toMatchObject({
        dnsMode: 'manual',
        domains: ['example.com', '*.example.com'],
    })
    expect(certificateRequestFormSchema.safeParse(form).success).toBeTrue()
})

test('strict request boundary rejects manual DNS mixed with provider credentials or HTTP', () => {
    const input = {
        name: 'Manual',
        domains: ['example.com'],
        challengeType: 'dns-01',
        dnsMode: 'manual',
        acceptTerms: true,
    }
    expect(requestCertificateInputSchema.safeParse(input).success).toBeTrue()
    expect(
        requestCertificateInputSchema.safeParse({ ...input, challengeType: 'http-01' }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({
            ...input,
            dnsProvider: { type: 'cloudflare', zoneId: 'a'.repeat(32), apiToken: 'fixture' },
        }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({ ...input, apiToken: 'unexpected' }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({ ...input, dnsMode: 'provider' }).success,
    ).toBeFalse()
})

test('shared DNS issuance sends a stable reference and never stale inline credentials', () => {
    const form = {
        ...request,
        challengeType: 'dns-01',
        dnsMode: 'provider',
        dnsConnectionId: '0198d98a-0000-7000-8000-000000000002',
        dnsConnectionProvider: 'cloudflare' as const,
        dnsZoneId: 'a'.repeat(32),
        dnsApiToken: 'stale-secret',
    }
    const input = certificateRequestInputFromForm(form)
    expect(requestCertificateInputSchema.parse(input).dnsProvider).toEqual({
        type: 'connection',
        provider: 'cloudflare',
        connectionId: form.dnsConnectionId,
        zoneId: form.dnsZoneId,
    })
    expect(JSON.stringify(input)).not.toContain('stale-secret')
    expect(certificateRequestFormSchema.safeParse(form).success).toBeTrue()
    expect(
        certificateRequestFormSchema.safeParse({ ...form, dnsConnectionId: '' }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({
            ...input,
            dnsProvider: {
                ...requestCertificateInputSchema.parse(input).dnsProvider,
                apiToken: 'forged',
            },
        }).success,
    ).toBeFalse()
})

test('certificate detail search accepts only a UUID selection and rejects arbitrary destinations', () => {
    expect(
        certificateDetailsSearchSchema.parse({
            selectedCertificateId: '0198d98a-0000-7000-8000-000000000001',
        }),
    ).toHaveProperty('selectedCertificateId')
    expect(
        certificateDetailsSearchSchema.safeParse({ selectedCertificateId: 'https://example.com' })
            .success,
    ).toBeFalse()
    expect(
        certificateDetailsSearchSchema.safeParse({
            selectedCertificateId: '0198d98a-0000-7000-8000-000000000001',
            redirect: 'https://example.com',
        }).success,
    ).toBeFalse()
})

test('delegated DNS requires a saved connection and rejects inline credentials and HTTP', () => {
    const form = {
        ...request,
        challengeType: 'dns-01',
        dnsMode: 'delegated',
        domains: ['*.example.com', 'example.com'],
        dnsConnectionId: '0198d98a-0000-7000-8000-000000000002',
        dnsConnectionProvider: 'desec' as const,
        dnsZoneId: '_acme-challenge.validation.example.net',
        dnsApiToken: 'stale-secret',
    }
    const input = certificateRequestInputFromForm(form)
    expect(requestCertificateInputSchema.parse(input)).toMatchObject({
        dnsMode: 'delegated',
        dnsProvider: { type: 'connection', provider: 'desec', zoneId: form.dnsZoneId },
    })
    expect(JSON.stringify(input)).not.toContain('stale-secret')
    expect(certificateRequestFormSchema.safeParse(form).success).toBeTrue()
    expect(
        certificateRequestFormSchema.safeParse({ ...form, dnsConnectionId: '' }).success,
    ).toBeFalse()
    expect(
        certificateRequestFormSchema.safeParse({ ...form, dnsConnectionId: undefined }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({ ...input, challengeType: 'http-01' }).success,
    ).toBeFalse()
    expect(
        requestCertificateInputSchema.safeParse({
            ...input,
            dnsProvider: { type: 'cloudflare', apiToken: 'fixture', zoneId: 'a'.repeat(32) },
        }).success,
    ).toBeFalse()
    for (const domain of [
        '_acme-challenge.example.com',
        '*.foo.*.example.com',
        'localhost',
        '192.0.2.1',
    ]) {
        expect(
            requestCertificateInputSchema.safeParse({ ...input, domains: [domain] }).success,
        ).toBeFalse()
    }
})
