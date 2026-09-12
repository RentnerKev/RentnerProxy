import { randomBytes } from 'node:crypto'

import { isCspNonce } from '../shared/Helpers/cspNonce'

function getAdminUiContentSecurityPolicy(nonce?: string): string {
    const styleSource = isCspNonce(nonce) ? `'self' 'nonce-${nonce}'` : "'self'"

    return [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline'",
        `style-src ${styleSource}`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'none'",
        "manifest-src 'self'",
    ].join('; ')
}

const ADMIN_UI_PERMISSIONS_POLICY = [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
].join(', ')

export function createCspNonce(): string {
    return randomBytes(16).toString('base64url')
}

export function getAdminUiSecurityHeaders(
    protocol: string,
    nonce?: string,
): Record<string, string> {
    return {
        'Content-Security-Policy': getAdminUiContentSecurityPolicy(nonce),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': ADMIN_UI_PERMISSIONS_POLICY,
        ...(protocol === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    }
}

export function applyAdminUiSecurityHeaders(
    response: Response,
    headers: Readonly<Record<string, string>>,
): Response {
    let mergedHeaders: Headers

    try {
        mergedHeaders = new Headers(response.headers)
        for (const [name, value] of Object.entries(headers)) {
            mergedHeaders.set(name, value)
        }
    } catch {
        return response
    }

    try {
        for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value)
        }
        return response
    } catch {
        try {
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: mergedHeaders,
            })
        } catch {
            return response
        }
    }
}
