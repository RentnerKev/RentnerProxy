const ADMIN_UI_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "manifest-src 'self'",
].join('; ')

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

export function getAdminUiSecurityHeaders(protocol: string): Record<string, string> {
    return {
        'Content-Security-Policy': ADMIN_UI_CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': ADMIN_UI_PERMISSIONS_POLICY,
        ...(protocol === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    }
}
