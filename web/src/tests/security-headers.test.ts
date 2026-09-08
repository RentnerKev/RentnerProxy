import { describe, expect, test } from 'bun:test'

import {
    applyAdminUiSecurityHeaders,
    createCspNonce,
    getAdminUiSecurityHeaders,
} from '../server/security-headers'

describe('admin UI security headers', () => {
    test('uses the restrictive policy without eval and enables HSTS only for HTTPS', () => {
        const httpHeaders = getAdminUiSecurityHeaders('http')
        const httpsHeaders = getAdminUiSecurityHeaders('https')

        expect(httpHeaders['Content-Security-Policy']).toContain(
            "script-src 'self' 'unsafe-inline'",
        )
        expect(httpHeaders['Content-Security-Policy']).not.toContain('unsafe-eval')
        expect(httpHeaders['Content-Security-Policy']).toContain("frame-ancestors 'none'")
        expect(httpHeaders['X-Frame-Options']).toBe('DENY')
        expect(httpHeaders['X-Content-Type-Options']).toBe('nosniff')
        expect(httpHeaders['Referrer-Policy']).toBe('no-referrer')
        expect(httpHeaders['Permissions-Policy']).toContain('camera=()')
        expect(httpHeaders['Strict-Transport-Security']).toBeUndefined()
        expect(httpsHeaders['Strict-Transport-Security']).toBe('max-age=31536000')
    })

    test('creates a cryptographically random nonce suitable for CSP and varies it per response', () => {
        const first = createCspNonce()
        const second = createCspNonce()

        expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/u)
        expect(second).toMatch(/^[A-Za-z0-9_-]{22}$/u)
        expect(first).not.toBe(second)
    })

    test('allows the matching nonce for injected styles without weakening style-src', () => {
        const nonce = 'test_nonce-123'
        const policy = getAdminUiSecurityHeaders('https', nonce)['Content-Security-Policy']

        expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`)
        expect(policy).not.toMatch(/style-src [^;]*unsafe-inline/u)
        expect(policy).toContain("style-src-attr 'unsafe-inline'")
    })

    test('does not interpolate an invalid nonce into the policy', () => {
        const policy = getAdminUiSecurityHeaders('https', "bad'; unsafe-inline")[
            'Content-Security-Policy'
        ]

        expect(policy).toContain("style-src 'self'")
        expect(policy).not.toContain("style-src 'self' 'nonce-")
        expect(policy).not.toContain("style-src 'unsafe-inline'")
    })

    test('preserves security headers on 404 and 500 responses without changing body, status, or cookies', async () => {
        await Promise.all(
            [404, 500].map(async (status) => {
                const nonce = createCspNonce()
                const headers = getAdminUiSecurityHeaders('https', nonce)
                const response = new Response('failure body', {
                    status,
                    statusText: 'Failure',
                    headers: [
                        ['set-cookie', 'session=keep-me; HttpOnly'],
                        ['set-cookie', 'theme=dark'],
                    ],
                })

                const securedResponse = applyAdminUiSecurityHeaders(response, headers)

                expect(securedResponse).toBe(response)
                expect(securedResponse.status).toBe(status)
                expect(securedResponse.statusText).toBe('Failure')
                expect(await securedResponse.text()).toBe('failure body')
                expect(securedResponse.headers.get('content-security-policy')).toContain(
                    `'nonce-${nonce}'`,
                )
                expect(securedResponse.headers.getSetCookie?.()).toEqual([
                    'session=keep-me; HttpOnly',
                    'theme=dark',
                ])
            }),
        )
    })
})
