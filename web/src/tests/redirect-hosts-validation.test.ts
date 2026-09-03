import { describe, expect, test } from 'bun:test'

import {
    createRedirectHostInputSchema,
    normalizeRedirectDestination,
    redirectHostFormSchema,
} from '../features/Admin/RedirectHostManagement/validation'

const base = {
    domains: ['Example.COM.'],
    destination: 'https://Example.com///',
    statusCode: 302,
    preserveRequestUri: true,
    enabled: true,
}

describe('Redirect Host destination validation', () => {
    test('canonicalizes preserve targets without a trailing slash', () => {
        expect(normalizeRedirectDestination('https://Example.com///', true)).toBe(
            'https://example.com',
        )
        expect(normalizeRedirectDestination('https://Example.com/path///', true)).toBe(
            'https://example.com/path',
        )
        expect(normalizeRedirectDestination('https://Example.com/path/', false)).toBe(
            'https://example.com/path/',
        )
    })

    test('rejects credentials, query/hash in preserve mode, malformed escapes, and controls', () => {
        for (const value of [
            'https://user:secret@example.com',
            'https://example.com/%ZZ',
            'https://example.com/%0d%0a',
            'https://example.com/%00',
            'https://example.com/%C2%80',
            '\r\nhttps://example.com',
            'https://example.com\r\n',
            'https://example.com/path?next=1',
            'https://example.com/path#section',
            'https://example.com/path\\next',
            'https://bad_host.test/path',
        ]) {
            expect(normalizeRedirectDestination(value, true), value).toBeNull()
        }
    })

    test('canonicalizes and validates destination host authorities', () => {
        expect(normalizeRedirectDestination('https://Example.com./path', false)).toBe(
            'https://example.com/path',
        )
        expect(normalizeRedirectDestination('https://bad_host.test/path', false)).toBeNull()
    })

    test('percent-encodes raw destination delimiters and returns canonical parsed output', () => {
        expect(normalizeRedirectDestination('https://example.com/a$"\'{}', false)).toBe(
            'https://example.com/a%24%22%27%7B%7D',
        )
    })

    test('normalizes domains and destination in create/form schemas', () => {
        const created = createRedirectHostInputSchema.parse(base)
        expect(created.domains).toEqual(['example.com'])
        expect(created.destination).toBe('https://example.com')

        const form = redirectHostFormSchema.parse({
            ...base,
            certificateId: null,
            statusCode: '308',
        })
        expect(form.statusCode).toBe(308)
        expect(form.destination).toBe('https://example.com')
        expect(
            createRedirectHostInputSchema.safeParse({ ...base, statusCode: '302' }).success,
        ).toBeFalse()
    })
})
