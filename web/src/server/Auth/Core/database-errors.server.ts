import '@tanstack/react-start/server-only'

import { isRecord } from '@/lib/Records/isRecord.ts'

const POSTGRES_UNIQUE_VIOLATION = '23505'

function isPostgresUniqueViolationCode(value: unknown): boolean {
    return value === POSTGRES_UNIQUE_VIOLATION || value === 23_505
}

export function isUniqueConstraintViolation(
    error: unknown,
    constraint?: string | ReadonlySet<string>,
): boolean {
    const seen = new Set<object>()
    let current: unknown = error

    while (isRecord(current) && !seen.has(current)) {
        seen.add(current)

        const constraintName =
            current.constraint ?? current.constraintName ?? current.constraint_name
        const matchesConstraint =
            constraint === undefined ||
            (typeof constraint === 'string'
                ? constraintName === constraint
                : typeof constraintName === 'string' && constraint.has(constraintName))
        if (
            matchesConstraint &&
            [current.code, current.errno, current.sqlState].some(isPostgresUniqueViolationCode)
        ) {
            return true
        }

        current = current.cause
    }

    return false
}
