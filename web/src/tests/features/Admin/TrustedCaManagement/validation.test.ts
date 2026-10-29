import { describe, expect, test } from 'bun:test'

import { MAX_TRUSTED_CA_PEM_BYTES } from '@/config/trusted-cas.config.ts'
import { createTrustedCaInputSchema } from '@/features/Admin/TrustedCaManagement/validation.ts'

const certificate = '-----BEGIN CERTIFICATE-----\nYWJjZA==\n-----END CERTIFICATE-----'

describe('trusted CA input validation', () => {
    test('accepts certificate bundles with CRLF and whitespace between blocks', () => {
        expect(
            createTrustedCaInputSchema.safeParse({
                name: 'Bundle',
                pem: `${certificate}\n\n${certificate}`.replaceAll('\n', '\r\n'),
            }).success,
        ).toBe(true)
    })

    test.each([
        '-----BEGIN CERTIFICATE-----\n'.repeat(4_000),
        `${certificate}\n-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----`,
        `${certificate}\ntext outside a certificate`,
        '-----BEGIN CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
        '-----END CERTIFICATE-----',
    ])('rejects malformed PEM without matching nested certificate suffixes', (pem) => {
        expect(createTrustedCaInputSchema.safeParse({ name: 'Invalid', pem }).success).toBe(false)
    })

    test('short-circuits oversized input before reporting format errors', () => {
        for (const pem of [
            'x'.repeat(MAX_TRUSTED_CA_PEM_BYTES + 1),
            'ä'.repeat(MAX_TRUSTED_CA_PEM_BYTES),
        ]) {
            const result = createTrustedCaInputSchema.safeParse({ name: 'Large', pem })
            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.error.issues.map((issue) => issue.message)).toEqual([
                    'admin.trustedCas.validation.pemLimit',
                ])
            }
        }
    })
})
