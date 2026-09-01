import { describe, expect, test } from 'bun:test'

import { getAdminUiSecurityHeaders } from '../server/security-headers'

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
})
