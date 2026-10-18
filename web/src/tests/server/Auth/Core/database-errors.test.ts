import { describe, expect, test } from 'bun:test'

import { isUniqueConstraintViolation } from '@/server/Auth/Core/database-errors.server.ts'
import { mapHostDomainUniqueViolation } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'

describe('database unique-constraint errors', () => {
    test('recognizes driver aliases through wrapped errors', () => {
        for (const field of ['code', 'errno', 'sqlState']) {
            for (const code of ['23505', 23_505]) {
                for (const name of ['constraint', 'constraintName', 'constraint_name']) {
                    const error = new Error('wrapped', {
                        cause: { [field]: code, [name]: 'expected_constraint' },
                    })
                    expect(isUniqueConstraintViolation(error)).toBe(true)
                    expect(isUniqueConstraintViolation(error, 'expected_constraint')).toBe(true)
                    expect(
                        isUniqueConstraintViolation(error, new Set(['expected_constraint'])),
                    ).toBe(true)
                    expect(isUniqueConstraintViolation(error, 'another_constraint')).toBe(false)
                }
            }
        }
    })

    test('requires the matching constraint and SQLSTATE on the same error', () => {
        expect(
            isUniqueConstraintViolation(
                { code: '23505', cause: { constraint: 'expected_constraint' } },
                'expected_constraint',
            ),
        ).toBe(false)
        expect(
            isUniqueConstraintViolation(
                { code: '23503', constraint: 'expected_constraint' },
                'expected_constraint',
            ),
        ).toBe(false)
        expect(isUniqueConstraintViolation({ code: '23505' }, 'expected_constraint')).toBe(false)
    })

    test('stops at primitives and cyclic causes without matching unrelated errors', () => {
        const first: Record<string, unknown> = { code: '23503' }
        const second: Record<string, unknown> = { cause: first }
        first.cause = second
        for (const error of [null, undefined, '23505', 23_505, first]) {
            expect(isUniqueConstraintViolation(error)).toBe(false)
        }
    })

    test('keeps both persisted host-domain constraint names', () => {
        for (const constraint of [
            'host_domains_domain_unique',
            'proxy_host_domains_domain_unique',
        ]) {
            expect(mapHostDomainUniqueViolation({ cause: { code: '23505', constraint } })).toEqual({
                code: 'domain_conflict',
                message: 'A host domain is already in use.',
            })
        }
        expect(
            mapHostDomainUniqueViolation({ code: '23505', constraint: 'unrelated_unique' }),
        ).toBeNull()
    })
})
