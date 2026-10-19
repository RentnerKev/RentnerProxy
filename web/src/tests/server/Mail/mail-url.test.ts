import { describe, expect, test } from 'bun:test'
import { createMailLogoUrl } from '@/server/Mail/mail-url.ts'

describe('external mail logo URLs', () => {
    test('uses the configured origin and normalized accent without carrying action tokens or paths', () => {
        const url = new URL(
            createMailLogoUrl('https://proxy.example:8443/base?token=private#old', '#8844EE'),
        )
        expect(url.origin).toBe('https://proxy.example:8443')
        expect(url.pathname).toBe('/media/mail-logo/8844ee')
        expect([...url.searchParams]).toEqual([['v', '1']])
        expect(url.hash).toBe('')
        expect(url.toString()).not.toContain('private')
    })

    test('supports native local development and safely normalizes invalid accents', () => {
        expect(createMailLogoUrl('http://localhost:5173', 'url(https://evil.example/image)')).toBe(
            'http://localhost:5173/media/mail-logo/30ee61?v=1',
        )
    })

    test.each([
        '',
        '/relative',
        'javascript:alert(1)',
        'data:image/png,abc',
        'file:///private',
        'https://user:pass@proxy.example',
    ])('rejects unsafe configured origins: %s', (origin) => {
        expect(() => createMailLogoUrl(origin, '#8844ee')).toThrow(
            'RENTNERPROXY_PUBLIC_ORIGIN is invalid.',
        )
    })
})
