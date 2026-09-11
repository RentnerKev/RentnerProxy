import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import {
    certificateCoversDomains,
    normalizeCertificateDomain,
} from '../../features/Admin/CertificateManagement/Helpers/certificateValidation'
import { requestCertificateInputSchema } from '../../features/Admin/CertificateManagement/validation'

const FUZZ_RUNS = 100
const dnsLabelArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/u)
const publicBaseDomainArbitrary = fc
    .tuple(dnsLabelArbitrary, dnsLabelArbitrary)
    .map(([subdomain, suffix]) => `${subdomain}.${suffix}.com`)
const cloudflareProvider = {
    type: 'cloudflare' as const,
    zoneId: 'a'.repeat(32),
    apiToken: 'test-token',
}

describe('certificate wildcard property fuzzing', () => {
    test('wildcards cover exactly one label and never broaden coverage', () => {
        fc.assert(
            fc.property(
                publicBaseDomainArbitrary,
                dnsLabelArbitrary,
                dnsLabelArbitrary,
                (baseDomain, label, deeperLabel) => {
                    const wildcard = `*.${baseDomain}`
                    expect(
                        certificateCoversDomains([wildcard], [`${label}.${baseDomain}`]),
                    ).toBeTrue()
                    expect(certificateCoversDomains([wildcard], [baseDomain])).toBeFalse()
                    expect(
                        certificateCoversDomains(
                            [wildcard],
                            [`${deeperLabel}.${label}.${baseDomain}`],
                        ),
                    ).toBeFalse()
                    expect(
                        certificateCoversDomains([wildcard], [`${label}.other.example`]),
                    ).toBeFalse()
                },
            ),
            { numRuns: FUZZ_RUNS },
        )
    })

    test('rejects malformed wildcard placements', () => {
        const malformedWildcardArbitrary = fc.oneof(
            publicBaseDomainArbitrary.map((baseDomain) => `*${baseDomain}`),
            fc
                .tuple(dnsLabelArbitrary, publicBaseDomainArbitrary)
                .map(([label, baseDomain]) => `${label}.*.${baseDomain}`),
            publicBaseDomainArbitrary.map((baseDomain) => `${baseDomain}.*`),
            publicBaseDomainArbitrary.map((baseDomain) => `*.*.${baseDomain}`),
            publicBaseDomainArbitrary.map((baseDomain) => `*.${baseDomain}/path`),
        )
        fc.assert(
            fc.property(malformedWildcardArbitrary, (domain) => {
                expect(normalizeCertificateDomain(domain)).toBeNull()
            }),
            { numRuns: FUZZ_RUNS },
        )
    })

    test('accepts mixed wildcard SANs only for DNS-01 with a valid provider', () => {
        fc.assert(
            fc.property(publicBaseDomainArbitrary, dnsLabelArbitrary, (baseDomain, label) => {
                const domains = [`*.${baseDomain}`, `${label}.${baseDomain}`]
                const dns = requestCertificateInputSchema.safeParse({
                    name: 'Wildcard',
                    domains,
                    challengeType: 'dns-01',
                    dnsProvider: cloudflareProvider,
                    acceptTerms: true,
                })
                expect(dns.success).toBeTrue()
                const http = requestCertificateInputSchema.safeParse({
                    name: 'Wildcard',
                    domains,
                    challengeType: 'http-01',
                    acceptTerms: true,
                })
                expect(http.success).toBeFalse()
            }),
            { numRuns: FUZZ_RUNS },
        )
    })
})
