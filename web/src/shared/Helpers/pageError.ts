import { isRecord } from './isRecord'

const PAGE_ERRORS = {
    DATABASE_SCHEMA: { status: 503, key: 'databaseSchema' },
    DATABASE_BUSY: { status: 503, key: 'databaseBusy' },
    DATABASE_UNAVAILABLE: { status: 503, key: 'databaseUnavailable' },
    DATABASE_AUTHENTICATION: { status: 503, key: 'databaseAuthentication' },
    SESSION_EXPIRED: { status: 401, key: 'sessionExpired' },
    ACCESS_DENIED: { status: 403, key: 'accessDenied' },
    NOT_FOUND: { status: 404, key: 'notFound' },
    RATE_LIMITED: { status: 429, key: 'rateLimited' },
    SERVICE_UNAVAILABLE: { status: 503, key: 'serviceUnavailable' },
    NETWORK: { status: 503, key: 'network' },
    ASSET_LOAD: { status: 503, key: 'assetLoad' },
    UNEXPECTED: { status: 500, key: 'unexpected' },
} as const

type PageErrorCode = keyof typeof PAGE_ERRORS

const KNOWN_CODES: Record<string, PageErrorCode> = {
    '42703': 'DATABASE_SCHEMA',
    '42P01': 'DATABASE_SCHEMA',
    '3F000': 'DATABASE_SCHEMA',
    '53300': 'DATABASE_BUSY',
    '28P01': 'DATABASE_AUTHENTICATION',
    '28000': 'DATABASE_AUTHENTICATION',
    '3D000': 'DATABASE_UNAVAILABLE',
    '57P01': 'DATABASE_UNAVAILABLE',
    '57P02': 'DATABASE_UNAVAILABLE',
    '57P03': 'DATABASE_UNAVAILABLE',
    ERR_POSTGRES_CONNECTION_REFUSED: 'DATABASE_UNAVAILABLE',
    ERR_POSTGRES_CONNECTION_TIMEOUT: 'DATABASE_UNAVAILABLE',
    ERR_POSTGRES_CONNECTION_CLOSED: 'DATABASE_UNAVAILABLE',
    ERR_POSTGRES_CONNECTION_FAILED: 'DATABASE_UNAVAILABLE',
    authentication_required: 'SESSION_EXPIRED',
    reauthentication_required: 'SESSION_EXPIRED',
    permission_denied: 'ACCESS_DENIED',
    owner_required: 'ACCESS_DENIED',
    user_not_found: 'NOT_FOUND',
    role_not_found: 'NOT_FOUND',
    service_unavailable: 'SERVICE_UNAVAILABLE',
    RATE_LIMITED: 'RATE_LIMITED',
    RATE_LIMIT_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    '401': 'SESSION_EXPIRED',
    '403': 'ACCESS_DENIED',
    '404': 'NOT_FOUND',
    '429': 'RATE_LIMITED',
    '503': 'SERVICE_UNAVAILABLE',
}

function reportedError(error: unknown) {
    if (!isRecord(error) || typeof error.message !== 'string') return null
    const match = /^RP_([A-Z_]+):([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/u.exec(
        error.message,
    )
    if (!match || !Object.hasOwn(PAGE_ERRORS, match[1]!)) return null
    return { code: match[1] as PageErrorCode, reference: match[2]! }
}

function classifyPageError(error: unknown): PageErrorCode {
    let cause = error
    let fallback: PageErrorCode = 'UNEXPECTED'
    // Drizzle wraps the driver's SQLSTATE in cause. Bound traversal also handles cycles safely.
    for (let depth = 0; depth < 8 && isRecord(cause); depth += 1) {
        for (const value of [
            cause.errno,
            cause.code,
            cause.sqlState,
            cause.statusCode,
            cause.status,
        ]) {
            const code = typeof value === 'number' ? String(value) : value
            if (typeof code !== 'string') continue
            if (Object.hasOwn(KNOWN_CODES, code)) {
                const known = KNOWN_CODES[code]!
                if (known !== 'SERVICE_UNAVAILABLE') return known
                fallback = known
            }
            if (code.startsWith('ERR_POSTGRES_AUTHENTICATION_')) return 'DATABASE_AUTHENTICATION'
            if (/^08[A-Z0-9]{3}$/u.test(code)) return 'DATABASE_UNAVAILABLE'
        }
        const message = typeof cause.message === 'string' ? cause.message : ''
        const domainCode = message.startsWith('errors.') ? message.slice('errors.'.length) : ''
        if (Object.hasOwn(KNOWN_CODES, domainCode)) {
            const known = KNOWN_CODES[domainCode]!
            if (known !== 'SERVICE_UNAVAILABLE') return known
            fallback = known
        }
        if (message === 'errors.rateLimited') return 'RATE_LIMITED'
        if (message === 'errors.authUnavailable') fallback = 'SERVICE_UNAVAILABLE'
        if (
            message === 'language.loadFailed' ||
            cause.name === 'ChunkLoadError' ||
            /^(?:Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed)/u.test(
                message,
            )
        ) {
            return 'ASSET_LOAD'
        }
        if (
            [
                'Failed to fetch',
                'fetch failed',
                'Load failed',
                'NetworkError when attempting to fetch resource.',
            ].includes(message)
        ) {
            return 'NETWORK'
        }
        cause = cause.cause
    }
    return fallback
}

export function getPageErrorDetails(error: unknown) {
    const reported = reportedError(error)
    const code = reported?.code ?? classifyPageError(error)
    return {
        code: `RP_${code}`,
        reference: reported?.reference ?? null,
        status: PAGE_ERRORS[code].status,
        translationKey: `system.error.causes.${PAGE_ERRORS[code].key}`,
        command: code === 'DATABASE_SCHEMA' ? 'bun run db:migrate' : null,
        reload: code === 'ASSET_LOAD',
    }
}

// TanStack serializes Error.message, not custom properties. Never include the original message/cause.
export function createPageError(error: unknown): Error {
    const existing = reportedError(error)
    const code = existing?.code ?? classifyPageError(error)
    return new Error(`RP_${code}:${existing?.reference ?? crypto.randomUUID()}`)
}
