import { PAGE_ERRORS, KNOWN_CODES } from '@/config/errors.config.ts'
import type { PageErrorCode } from './Types/page-error.types.ts'
import { isRecord } from '@/lib/Records/isRecord.ts'

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

export function createPageError(error: unknown): Error {
    const existing = reportedError(error)
    const code = existing?.code ?? classifyPageError(error)
    return new Error(`RP_${code}:${existing?.reference ?? crypto.randomUUID()}`)
}
