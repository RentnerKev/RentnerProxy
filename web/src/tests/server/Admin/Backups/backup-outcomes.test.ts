import { expect, test } from 'bun:test'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type {
    ManagedBackupStatus,
    ManagedBackupAuditEvent,
} from '@/lib/Backups/Types/backups.types.ts'
import {
    createBackupAuditIngestor,
    planBackupAuditBatch,
} from '@/server/Admin/Backups/backup-outcomes.ts'
import { createBackupAuditWorker } from '@/server/Admin/Backups/backup-outcomes.worker.ts'
import type {
    BackupAuditCursor,
    BackupAuditDependencies,
} from '@/server/Admin/Backups/Types/backup-outcomes.types.ts'

const storeId = '00000000-0000-4000-8000-000000000001'
const jobId = '00000000-0000-4000-8000-000000000002'
const actorId = '00000000-0000-4000-8000-000000000003'
const event = (
    sequence: number,
    kind: ManagedBackupAuditEvent['kind'] = 'succeeded',
): ManagedBackupAuditEvent => ({ sequence, kind, jobId, actorId, at: 1000 + sequence })
const snapshot = (events: ManagedBackupAuditEvent[], id = storeId): ManagedBackupStatus => ({
    storeId: id,
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 7,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: events,
})
const freshSignal = () => new AbortController().signal

function persistence() {
    let cursor: BackupAuditCursor = { storeId: null, sequence: 0 }
    let chain = Promise.resolve()
    let audit: AuditEventInput[] = []
    let failSave = false
    let failAppend = false
    const transaction: BackupAuditDependencies['transaction'] = (run) => {
        const pending = chain.then(async () => {
            let draft = structuredClone(cursor)
            const rows: AuditEventInput[] = []
            const value = await run({
                cursor: draft,
                append: async (events) => {
                    if (failAppend) throw new Error('append unavailable')
                    rows.push(...events)
                },
                save: async (nextCursor) => {
                    if (failSave) throw new Error('save unavailable')
                    draft = structuredClone(nextCursor)
                },
            })
            cursor = draft
            audit.push(...rows)
            return value
        })
        chain = pending.then(
            () => {},
            () => {},
        )
        return pending
    }
    return {
        transaction,
        cursor: () => cursor,
        audit: () => audit,
        failSave: (value: boolean) => {
            failSave = value
        },
        failAppend: (value: boolean) => {
            failAppend = value
        },
    }
}

test('root backup outcomes map to honest audit actions, actor identities and safe metadata', () => {
    const kinds: ManagedBackupAuditEvent['kind'][] = [
        'requested',
        'started',
        'succeeded',
        'failed',
        'interrupted',
        'pruned',
        'configuration_updated',
    ]
    const batch = planBackupAuditBatch(
        { storeId: null, sequence: 0 },
        snapshot(
            kinds.map((kind, i) => ({
                sequence: i + 1,
                kind,
                jobId: kind === 'configuration_updated' ? null : jobId,
                actorId: kind === 'requested' ? null : actorId,
                at: 1001 + i,
            })),
        ),
    )
    expect(batch.events.map((item) => item.action)).toEqual([
        'request',
        'started',
        'save',
        'failed',
        'failed',
        'delete',
        'update',
    ])
    expect(batch.events.map((item) => item.result)).toEqual([
        'success',
        'success',
        'success',
        'failure',
        'failure',
        'success',
        'success',
    ])
    expect(batch.events[0]).toMatchObject({
        actorKind: 'system',
        actorUserId: null,
        resource: 'config-export',
        targetId: jobId,
    })
    expect(batch.events[2]).toMatchObject({
        actorKind: 'user',
        actorUserId: actorId,
        metadata: { operationId: jobId, occurredAt: new Date(1003).toISOString() },
    })
    expect(batch.events[6]).toMatchObject({
        resource: 'security-settings',
        targetId: null,
        metadata: { occurredAt: new Date(1007).toISOString() },
    })
})

test('concurrent workers and process restart share durable cursor without duplicate outcomes', async () => {
    const store = persistence()
    let reads = 0
    const dependencies: BackupAuditDependencies = {
        transaction: store.transaction,
        status: async () => {
            reads++
            return snapshot([event(1), event(2, 'failed')])
        },
    }
    const first = createBackupAuditIngestor(dependencies)
    const second = createBackupAuditIngestor(dependencies)
    expect(await Promise.all([first(freshSignal()), second(freshSignal())])).toEqual([2, 0])
    expect(await createBackupAuditIngestor(dependencies)(freshSignal())).toBe(0)
    expect(store.audit()).toHaveLength(2)
    expect(reads).toBe(3)
    expect(store.cursor()).toEqual({ storeId, sequence: 2 })
})

test.each(['append', 'save'] as const)(
    '%s failure atomically rolls back audit and cursor so retry ingests once',
    async (failure) => {
        const store = persistence()
        const ingest = createBackupAuditIngestor({
            transaction: store.transaction,
            status: async () => snapshot([event(1)]),
        })
        if (failure === 'append') store.failAppend(true)
        else store.failSave(true)
        await expect(ingest(freshSignal())).rejects.toThrow()
        expect(store.audit()).toHaveLength(0)
        expect(store.cursor()).toEqual({ storeId: null, sequence: 0 })
        store.failAppend(false)
        store.failSave(false)
        expect(await ingest(freshSignal())).toBe(1)
        expect(await ingest(freshSignal())).toBe(0)
        expect(store.audit()).toHaveLength(1)
    },
)

test('bounded ingestion catches up in batches and new root stores reset the cursor', async () => {
    const store = persistence()
    let current = snapshot(Array.from({ length: 250 }, (_, i) => event(i + 1)))
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => current,
    })
    expect(await ingest(freshSignal())).toBe(100)
    expect(store.cursor().sequence).toBe(100)
    expect(await ingest(freshSignal())).toBe(100)
    expect(await ingest(freshSignal())).toBe(50)
    expect(await ingest(freshSignal())).toBe(0)
    current = snapshot([event(1)], actorId)
    expect(await ingest(freshSignal())).toBe(1)
    expect(store.cursor()).toEqual({ storeId: actorId, sequence: 1 })
    expect(store.audit()).toHaveLength(251)
})

test('unavailable root or aborted synchronization cannot fabricate outcomes or advance cursor', async () => {
    const store = persistence()
    const unavailable = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => {
            throw new Error('root unavailable')
        },
    })
    await expect(unavailable(freshSignal())).rejects.toThrow()
    const controller = new AbortController()
    const cancelled = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => {
            controller.abort()
            return snapshot([event(1)])
        },
    })
    await expect(cancelled(controller.signal)).rejects.toThrow()
    expect(store.audit()).toHaveLength(0)
    expect(store.cursor()).toEqual({ storeId: null, sequence: 0 })
})

test('invalid duplicate/out-of-order sequences cannot skip or duplicate durable root events', () => {
    expect(() =>
        planBackupAuditBatch({ storeId: null, sequence: 0 }, snapshot([event(2), event(1)])),
    ).toThrow()
    expect(() =>
        planBackupAuditBatch({ storeId: null, sequence: 0 }, snapshot([event(1), event(1)])),
    ).toThrow()
})

test('worker coalesces overlapping polls, aborts shutdown, and reports only availability transitions', async () => {
    let resolve: (() => void) | undefined
    let calls = 0
    let warnings = 0
    let pendingSignal: AbortSignal | undefined
    let fail = true
    const worker = createBackupAuditWorker({
        ingest: async (signal) => {
            calls++
            pendingSignal = signal
            if (calls === 1)
                await new Promise<void>((done) => {
                    resolve = done
                })
            if (fail) throw new Error('private transport error')
        },
        unavailable: () => {
            warnings++
        },
    })
    const first = worker.runOnce()
    const repeated = worker.runOnce()
    expect(first).toBe(repeated)
    await Promise.resolve()
    resolve?.()
    await first
    await worker.runOnce()
    expect(calls).toBe(2)
    expect(warnings).toBe(1)
    fail = false
    await worker.runOnce()
    fail = true
    await worker.runOnce()
    expect(warnings).toBe(2)
    const stopping = createBackupAuditWorker({
        ingest: async (signal) => {
            pendingSignal = signal
            await new Promise<void>((done) =>
                signal.addEventListener('abort', () => done(), { once: true }),
            )
        },
        unavailable: () => {
            warnings++
        },
    })
    const pending = stopping.runOnce()
    await Promise.resolve()
    await stopping.stop()
    await pending
    expect(pendingSignal?.aborted).toBe(true)
    expect(warnings).toBe(2)
})
