import { afterEach, expect, test } from 'bun:test'

import { getApplicationRevision } from '@/server/WebSockets/applicationChanges.ts'
import {
    markAuditedApplicationMutation,
    withCommittedApplicationChanges,
} from '@/server/WebSockets/committedChanges.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

const mutation: AuditEventInput = {
    actorUserId: 'user-1',
    actorKind: 'user',
    action: 'update',
    resource: 'user',
    targetId: 'user-1',
    result: 'success',
}

afterEach(() => {
    const events = globalThis.rentnerproxyRealtimeEvents
    if (events?.notificationTimer) clearTimeout(events.notificationTimer)
    if (events?.publishTimer) clearTimeout(events.publishTimer)
    globalThis.rentnerproxyRealtimeEvents = undefined
})

test('publishes only after an authenticated mutation commits', async () => {
    const transaction = {}
    const before = getApplicationRevision()
    const result = await withCommittedApplicationChanges(
        async (run) => {
            const committedResult = await run(transaction)
            expect(getApplicationRevision()).toBe(before)
            return committedResult
        },
        async (current) => {
            markAuditedApplicationMutation(current, mutation)
            return 'committed'
        },
    )
    expect(result).toBe('committed')
    expect(getApplicationRevision()).not.toBe(before)
})

test('does not publish rolled back mutations or reuse their markers', async () => {
    const transaction = {}
    const before = getApplicationRevision()
    await expect(
        withCommittedApplicationChanges(
            async (run) => {
                await run(transaction)
                throw new Error('commit failed')
            },
            async (current) => {
                markAuditedApplicationMutation(current, mutation)
            },
        ),
    ).rejects.toThrow('commit failed')
    await withCommittedApplicationChanges(
        (run) => run(transaction),
        async () => undefined,
    )
    expect(getApplicationRevision()).toBe(before)
})

test('does not publish no-ops, rejected requests or unauthenticated audit events', async () => {
    const before = getApplicationRevision()
    await Promise.all(
        [
            undefined,
            { ...mutation, result: 'failure' as const },
            { ...mutation, result: 'denied' as const },
            { ...mutation, actorKind: 'anonymous' as const },
            { ...mutation, actorUserId: null },
            { ...mutation, metadata: { changedFields: [] } },
            { ...mutation, resource: 'config-export' as const },
        ].map((event) =>
            withCommittedApplicationChanges(
                (run) => run({}),
                async (transaction) => {
                    if (event) markAuditedApplicationMutation(transaction, event)
                },
            ),
        ),
    )
    expect(getApplicationRevision()).toBe(before)
})

test('the database adapter promotes only released savepoints and publishes after root commit', async () => {
    const stdout = await runBunScript(
        `
        import { mock } from 'bun:test'
        let failCommit = false
        let failRelease = false
        let commits = 0
        const createTransaction = () => ({
            transaction: async (run) => {
                const result = await run(createTransaction())
                if (failRelease) throw new Error('release failed')
                return result
            },
        })
        const original = {
            marker: 'preserved',
            transaction: async (run) => {
                const result = await run(createTransaction())
                if (failCommit) throw new Error('outer rollback')
                commits++
                return result
            },
        }
        mock.module('./db/index.ts', () => ({ db: original }))
        const { getAuthDatabase } = await import('./server/Auth/Core/database.server.ts')
        const { markAuditedApplicationMutation: mark } = await import('./server/WebSockets/committedChanges.ts')
        const { getApplicationRevision: revision } = await import('./server/WebSockets/applicationChanges.ts')
        const database = getAuthDatabase()
        const event = ${JSON.stringify(mutation)}
        const results = []
        async function attempt(run) {
            const before = revision()
            try { await database.transaction(run) } catch {}
            results.push(revision() !== before)
        }
        // Matches bulk-hosts.storage.server.ts: savepoint(transaction, run) => transaction.transaction(run).
        await attempt(async (outer) => {
            const before = revision()
            await outer.transaction(async (inner) => {
                await inner.transaction(async (deep) => mark(deep, event))
            })
            if (revision() !== before) throw new Error('published before root commit')
        })
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => { mark(inner, event); throw new Error('rollback child') }) } catch {}
        })
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => { mark(inner, event); throw new Error('rollback child') }) } catch {}
            await outer.transaction(async (sibling) => mark(sibling, event))
        })
        failCommit = true
        await attempt(async (outer) => {
            await outer.transaction(async (inner) => mark(inner, event))
        })
        failCommit = false
        failRelease = true
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => mark(inner, event)) } catch {}
        })
        console.log(JSON.stringify({ results, commits, same: database === getAuthDatabase(), marker: database.marker }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    expect(JSON.parse(stdout)).toEqual({
        results: [true, false, true, false, false],
        commits: 4,
        same: true,
        marker: 'preserved',
    })
})
