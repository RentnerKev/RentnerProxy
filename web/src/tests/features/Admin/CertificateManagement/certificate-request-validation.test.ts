import { expect, test } from 'bun:test'

import {
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
