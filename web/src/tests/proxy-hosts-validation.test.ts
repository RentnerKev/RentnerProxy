import { describe, expect, test } from 'bun:test'

import {
    createProxyHostInputSchema,
    proxyDomainSchema,
    proxyForwardHostSchema,
    proxyForwardPortSchema,
    proxyHostDomainsSchema,
    proxyHostFormSchema,
    proxyHostIdInputSchema,
    updateProxyHostInputSchema,
} from '../features/Admin/ProxyHostManagement/validation'
import {
    normalizeForwardHost,
    normalizeProxyDomain,
} from '../features/Admin/ProxyHostManagement/Helpers/proxyHostValidation'

const validInput = {
    domains: ['Example.COM.'],
    enabled: true,
    forwardHost: 'backend.internal',
    forwardPort: 8080,
    forwardScheme: 'http',
} as const

function expectAccepted<T>(result: { success: boolean; data?: T }): T {
    expect(result.success).toBeTrue()
    if (!result.success) throw new Error('Expected validation to succeed.')
    return result.data as T
}

describe('ProxyHost normalization', () => {
    test('canonicalizes DNS domains, including Unicode IDN and one trailing dot', () => {
        expect(normalizeProxyDomain('  Example.COM.  ')).toBe('example.com')
        expect(normalizeProxyDomain('BÜCHER.Example')).toBe('xn--bcher-kva.example')
        expect(normalizeProxyDomain('localhost')).toBe('localhost')
        expect(normalizeProxyDomain('service.local')).toBe('service.local')
    })

    test('rejects non DNS domain forms and malformed label boundaries', () => {
        const maxLengthDomain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
        const invalid = [
            '',
            '   ',
            'foo bar.example',
            '_service.example',
            'https://example.com',
            'example.com:443',
            '*.example.com',
            '127.0.0.1',
            '[::1]',
            'foo..example',
            'example.com..',
            '-example.com',
            'example-.com',
            `${'a'.repeat(64)}.example`,
            `${maxLengthDomain}x`,
        ]

        expect(normalizeProxyDomain(maxLengthDomain)).toBe(maxLengthDomain)
        expect(normalizeProxyDomain(`${'a'.repeat(64)}.example`)).toBeNull()
        for (const value of invalid) {
            expect(normalizeProxyDomain(value), value).toBeNull()
        }
    })

    test('canonicalizes forward DNS and strict IPv4/IPv6 hosts', () => {
        expect(normalizeForwardHost('  EXAMPLE.com. ')).toBe('example.com')
        expect(normalizeForwardHost('BÜCHER.example')).toBe('xn--bcher-kva.example')
        expect(normalizeForwardHost('192.0.2.1')).toBe('192.0.2.1')
        expect(normalizeForwardHost('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
        expect(normalizeForwardHost('[2001:0db8::1]')).toBe('2001:db8::1')
    })

    test('rejects URLs, host ports, wildcards, credentials, internals, and bad IPs', () => {
        const invalid = [
            'https://backend.example',
            'backend.example:8080',
            'backend.example/path',
            'backend.example?query=1',
            'user:password@backend.example',
            '*.backend.example',
            '_backend.example',
            '256.1.1.1',
            '1.2.3',
            '01.2.3.4',
            '[fe80::1%25eth0]',
            'fe80::1%eth0',
            '[not-an-ip]',
        ]

        for (const value of invalid) {
            expect(normalizeForwardHost(value), value).toBeNull()
        }
    })
})

describe('ProxyHost validation schemas', () => {
    test('accepts and normalizes individual domains and forward hosts', () => {
        expect(expectAccepted(proxyDomainSchema.safeParse('Example.COM.'))).toBe('example.com')
        expect(expectAccepted(proxyForwardHostSchema.safeParse('[2001:db8::1]'))).toBe(
            '2001:db8::1',
        )
    })

    test('enforces one to fifty unique domains after normalization', () => {
        expect(proxyHostDomainsSchema.safeParse(['a.example']).success).toBeTrue()
        expect(
            proxyHostDomainsSchema.safeParse(
                Array.from({ length: 50 }, (_, index) => `host-${index}.example`),
            ).success,
        ).toBeTrue()
        expect(proxyHostDomainsSchema.safeParse([]).success).toBeFalse()
        expect(
            proxyHostDomainsSchema.safeParse(Array.from({ length: 51 }, () => 'a.example')).success,
        ).toBeFalse()
        expect(
            proxyHostDomainsSchema.safeParse(['Example.COM', 'example.com.']).success,
        ).toBeFalse()
        expect(
            proxyHostDomainsSchema.safeParse(['bücher.example', 'xn--bcher-kva.example']).success,
        ).toBeFalse()

        const parsed = expectAccepted(
            proxyHostDomainsSchema.safeParse(['Example.COM.', 'BÜCHER.example']),
        )
        expect(parsed).toEqual(['example.com', 'xn--bcher-kva.example'])
    })

    test('accepts the complete create and update contracts with canonical values', () => {
        const created = expectAccepted(createProxyHostInputSchema.safeParse(validInput))
        expect(created).toMatchObject({
            domains: ['example.com'],
            enabled: true,
            forwardHost: 'backend.internal',
            forwardPort: 8080,
            forwardScheme: 'http',
        })

        const updated = expectAccepted(
            updateProxyHostInputSchema.safeParse({
                ...validInput,
                domains: ['BÜCHER.example'],
                proxyHostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
            }),
        )
        expect(updated.domains).toEqual(['xn--bcher-kva.example'])
        expect(updated.proxyHostId).toBe('018f2f52-7c1b-7cc0-9f3c-6a9952c54019')
    })

    test('validates UUID ids and rejects malformed full inputs', () => {
        expect(proxyHostIdInputSchema.safeParse({ proxyHostId: validInput }).success).toBeFalse()
        expect(proxyHostIdInputSchema.safeParse({ proxyHostId: 'not-a-uuid' }).success).toBeFalse()
        expect(
            proxyHostIdInputSchema.safeParse({
                proxyHostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
            }).success,
        ).toBeTrue()

        for (const input of [
            { ...validInput, domains: [] },
            { ...validInput, forwardScheme: 'ftp' },
            { ...validInput, forwardPort: 0 },
            { ...validInput, forwardPort: 65_536 },
            { ...validInput, forwardHost: 'backend.example:443' },
        ]) {
            expect(createProxyHostInputSchema.safeParse(input).success).toBeFalse()
        }
    })

    test('parses form ports from decimal strings and rejects empty, exponent, and NaN values', () => {
        const parsed = expectAccepted(
            proxyHostFormSchema.safeParse({
                ...validInput,
                domains: ['Example.COM.'],
                forwardPort: '8443',
            }),
        )
        expect(parsed.forwardPort).toBe(8443)

        for (const forwardPort of ['', ' ', '1e3', 'NaN', '8080.5', '0', '65536']) {
            expect(
                proxyHostFormSchema.safeParse({ ...validInput, forwardPort }).success,
                forwardPort,
            ).toBeFalse()
        }
    })

    test('accepts only configured HTTP forward schemes', () => {
        for (const forwardScheme of ['http', 'https']) {
            expect(
                createProxyHostInputSchema.safeParse({ ...validInput, forwardScheme }).success,
            ).toBeTrue()
        }
        for (const forwardScheme of ['HTTP', 'ftp', '']) {
            expect(
                createProxyHostInputSchema.safeParse({ ...validInput, forwardScheme }).success,
            ).toBeFalse()
        }
    })

    test('enforces the 1..65535 integer port range', () => {
        for (const forwardPort of [1, 65_535]) {
            expect(proxyForwardPortSchema.safeParse(forwardPort).success).toBeTrue()
        }
        for (const forwardPort of [0, -1, 65_536, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(proxyForwardPortSchema.safeParse(forwardPort).success).toBeFalse()
        }
    })
})
