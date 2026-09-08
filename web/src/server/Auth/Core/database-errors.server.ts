import '@tanstack/react-start/server-only'

import { isRecord } from '../../../shared/Helpers/isRecord'

const POSTGRES_UNIQUE_VIOLATION = '23505'

function isPostgresUniqueViolationCode(value: unknown): boolean {
    return value === POSTGRES_UNIQUE_VIOLATION || value === 23_505
}

/** Drizzle exposes Bun's PostgreSQL error through one or more `cause` wrappers. */
export function isUniqueConstraintViolation(error: unknown): boolean {
    const seen = new Set<object>()
    let current: unknown = error

    while (isRecord(current) && !seen.has(current)) {
        seen.add(current)

        if ([current.code, current.errno, current.sqlState].some(isPostgresUniqueViolationCode)) {
            return true
        }

        current = current.cause
    }

    return false
}
