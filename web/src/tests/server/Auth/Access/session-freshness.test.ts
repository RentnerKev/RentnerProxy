import { describe, expect, test } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import { requireActiveSessionInTransaction } from '@/server/Auth/Access/sessions.service.ts'

const session = {
    id: 'active-session',
    user: { id: 'current-user' },
    reauthenticatedAt: new Date(0),
} as CurrentSession

function fixture(rows: readonly { readonly expiresAt: Date }[]) {
    const checks: { condition?: SQL; lock?: string } = {}
    const transaction = {
        select: () => ({
            from: () => ({
                where: (condition: SQL) => {
                    checks.condition = condition
                    return {
                        limit: () => ({
                            for: async (lock: string) => {
                                checks.lock = lock
                                return rows
                            },
                        }),
                    }
                },
            }),
        }),
    } as unknown as AuthTransaction
    return { transaction, checks }
}

describe('active session mutation fence', () => {
    test.each([new Date(0), new Date(Date.now() + 60_000)])(
        'accepts an active session regardless of its compatibility authentication timestamp %s',
        async (reauthenticatedAt) => {
            const { transaction, checks } = fixture([{ expiresAt: new Date(Date.now() + 60_000) }])
            await requireActiveSessionInTransaction(transaction, { ...session, reauthenticatedAt })
            expect(checks.lock).toBe('update')
            const query = new PgDialect().sqlToQuery(checks.condition!)
            expect(query.params).toEqual([session.id, session.user.id])
        },
    )
    test.each([{ rows: [] }, { rows: [{ expiresAt: new Date(0) }] }])(
        'rejects a revoked or expired persisted session',
        async ({ rows }) => {
            const { transaction } = fixture(rows)
            await expect(
                requireActiveSessionInTransaction(transaction, session),
            ).rejects.toMatchObject({
                code: 'authentication_required',
            })
        },
    )
})
