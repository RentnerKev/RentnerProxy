import { describe, expect, mock, test } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
    assignHostTagsInTransaction,
    readHostTags,
} from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

const tag = { id: '00000000-0000-4000-8000-000000000001', name: 'Infra' }
const hostId = '00000000-0000-4000-8000-000000000002'

function setup(value: unknown) {
    const rows: { key: string; value: SQL }[] = []
    const read = mock(async () => [{ value }])
    const transaction = {
        select: () => ({ from: () => ({ where: () => ({ limit: read }) }) }),
        insert: () => ({
            values: (row: { key: string; value: SQL }) => ({
                onConflictDoUpdate: async () => {
                    rows.push(row)
                },
            }),
        }),
    } as unknown as AuthTransaction
    return { transaction, read, rows }
}

describe('host classification storage within host transactions', () => {
    test('preserves assignments without reading or writing when older clients or discovery omit tag IDs', async () => {
        const fixture = setup({ invalid: 'not read' })
        expect(
            await assignHostTagsInTransaction(fixture.transaction, 'proxy', hostId, undefined),
        ).toBeUndefined()
        expect(fixture.read).not.toHaveBeenCalled()
        expect(fixture.rows).toHaveLength(0)
    })
    test.each(['proxy', 'redirect'] as const)(
        'writes only changed assignments for %s hosts',
        async (kind) => {
            const state = { version: 1, revision: 1, tags: [tag], assignments: {} }
            const fixture = setup(state)
            expect(
                await assignHostTagsInTransaction(fixture.transaction, kind, hostId, [tag.id]),
            ).toEqual([tag])
            expect(fixture.rows[0]?.key).toBe('host_tags_' + kind + '_v1')
            const written = new PgDialect().sqlToQuery(fixture.rows[0]!.value).params[0]
            expect(written).toEqual({ ...state, revision: 2, assignments: { [hostId]: [tag.id] } })
            const unchanged = setup(written)
            await assignHostTagsInTransaction(unchanged.transaction, kind, hostId, [tag.id])
            expect(unchanged.rows).toHaveLength(0)
        },
    )
    test('removes deleted host references while retaining the catalog', async () => {
        const state = {
            version: 1 as const,
            revision: 1,
            tags: [tag],
            assignments: { [hostId]: [tag.id] },
        }
        const fixture = setup(state)
        await assignHostTagsInTransaction(fixture.transaction, 'proxy', hostId, [])
        expect(new PgDialect().sqlToQuery(fixture.rows[0]!.value).params[0]).toEqual({
            ...state,
            revision: 2,
            assignments: {},
        })
    })
    test('accepts JSON-string storage from a restored backup and fails closed on invalid references', async () => {
        const state = {
            version: 1 as const,
            revision: 1,
            tags: [tag],
            assignments: { [hostId]: [tag.id] },
        }
        expect(await readHostTags(setup(JSON.stringify(state)).transaction, 'redirect')).toEqual(
            state,
        )
        const invalid = setup({ ...state, tags: [] })
        await expect(
            assignHostTagsInTransaction(invalid.transaction, 'redirect', hostId, []),
        ).rejects.toThrow()
        expect(invalid.rows).toHaveLength(0)
    })
})
