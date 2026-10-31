// oxlint-disable no-await-in-loop -- Ordered outage fixtures finish each job and durable batch before advancing.
import { enqueueBackupOutcomeNotifications } from '@/server/Notifications/backup-outcomes.ts'
import { createNotificationState } from '@/server/Notifications/incident-engine.ts'
import type { NotificationEngineConfiguration } from '@/server/Notifications/Types/notification-state.types.ts'
import { expect, test } from 'bun:test'
import { createManagedBackupEngine } from '../../../../../../scripts/backup/managed-jobs.ts'
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

const notificationConfiguration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: '00000000-0000-4000-8000-000000000004',
            revision: 1,
            name: 'Backup results',
            kind: 'webhook',
            enabled: true,
            events: ['backup'],
            recovery: true,
            minimumSeverity: 'error',
            thresholdSeconds: 0,
        },
    ],
}
function persistence(
    configuration?: NotificationEngineConfiguration,
    initialCursor: BackupAuditCursor = { storeId: null, sequence: 0 },
) {
    let queue = createNotificationState()
    let idSequence = 10000
    const makeId = () => `00000000-0000-4000-8000-${String(idSequence++).padStart(12, '0')}`
    let cursor: BackupAuditCursor = structuredClone(initialCursor)
    let chain = Promise.resolve()
    let audit: AuditEventInput[] = []
    let failSave = false
    let failAppend = false
    let failCommit = false
    const transaction: BackupAuditDependencies['transaction'] = (run) => {
        const pending = chain.then(async () => {
            let draft = structuredClone(cursor)
            const rows: AuditEventInput[] = []
            let draftQueue = structuredClone(queue)
            const value = await run({
                cursor: draft,
                enqueue: async (events) => {
                    if (!configuration) return { accepted: events.length, changed: false }
                    const result = enqueueBackupOutcomeNotifications(
                        draftQueue,
                        configuration,
                        events,
                        2000,
                        makeId,
                    )
                    draftQueue = result.state
                    return { accepted: result.accepted, changed: result.queued > 0 }
                },
                append: async (events) => {
                    if (failAppend) throw new Error('append unavailable')
                    rows.push(...events)
                },
                save: async (nextCursor) => {
                    if (failSave) throw new Error('save unavailable')
                    draft = structuredClone(nextCursor)
                },
            })
            if (failCommit) throw new Error('commit unavailable')
            cursor = draft
            queue = draftQueue
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
        queue: () => queue,
        seedQueue: (state: typeof queue) => {
            queue = structuredClone(state)
        },
        drainQueue: () => {
            for (const delivery of queue.deliveries) delivery.status = 'succeeded'
        },
        failCommit: (value: boolean) => {
            failCommit = value
        },
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
        acknowledge: async () => {},
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

test.each(['append', 'save', 'commit'] as const)(
    '%s failure atomically rolls back audit and cursor so retry ingests once',
    async (failure) => {
        const store = persistence()
        const ingest = createBackupAuditIngestor({
            transaction: store.transaction,
            acknowledge: async () => {},
            status: async () => snapshot([event(1)]),
        })
        if (failure === 'append') store.failAppend(true)
        else if (failure === 'save') store.failSave(true)
        else store.failCommit(true)
        await expect(ingest(freshSignal())).rejects.toThrow()
        expect(store.audit()).toHaveLength(0)
        expect(store.cursor()).toEqual({ storeId: null, sequence: 0 })
        store.failAppend(false)
        store.failSave(false)
        store.failCommit(false)
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
        acknowledge: async () => {},
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
        acknowledge: async () => {},
        status: async () => {
            throw new Error('root unavailable')
        },
    })
    await expect(unavailable(freshSignal())).rejects.toThrow()
    const controller = new AbortController()
    const cancelled = createBackupAuditIngestor({
        transaction: store.transaction,
        acknowledge: async () => {},
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

test.each([{ sequences: [2] }, { sequences: [1, 3] }, { sequences: [1, 2, 4] }])(
    'audit sequence gaps %j fail before append, commit or acknowledgement',
    async ({ sequences }) => {
        const store = persistence()
        let acknowledgements = 0
        const ingest = createBackupAuditIngestor({
            transaction: store.transaction,
            status: async () => snapshot(sequences.map((sequence) => event(sequence))),
            acknowledge: async () => {
                acknowledgements++
            },
        })
        await expect(ingest(freshSignal())).rejects.toThrow()
        expect(store.audit()).toEqual([])
        expect(store.cursor()).toEqual({ storeId: null, sequence: 0 })
        expect(acknowledgements).toBe(0)
    },
)

test.each(['append', 'save', 'commit'] as const)(
    '%s failure never acknowledges uncommitted root events',
    async (failure) => {
        const store = persistence()
        if (failure === 'append') store.failAppend(true)
        else if (failure === 'save') store.failSave(true)
        else store.failCommit(true)
        let acknowledged = false
        const ingest = createBackupAuditIngestor({
            transaction: store.transaction,
            status: async () => snapshot([event(1)]),
            acknowledge: async () => {
                acknowledged = true
            },
        })
        await expect(ingest(freshSignal())).rejects.toThrow()
        expect(acknowledged).toBe(false)
        expect(store.audit()).toEqual([])
    },
)

test('acknowledgement failure after commit retries disposal without duplicating audit rows', async () => {
    const store = persistence()
    let fail = true
    let acknowledgements = 0
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot([event(1), event(2)]),
        acknowledge: async (cursor) => {
            acknowledgements++
            expect(store.cursor()).toEqual(cursor)
            expect(store.audit()).toHaveLength(2)
            if (fail) throw new Error('ack transport unavailable')
        },
    })
    await expect(ingest(freshSignal())).rejects.toThrow('ack transport unavailable')
    expect(store.cursor()).toEqual({ storeId, sequence: 2 })
    fail = false
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.audit()).toHaveLength(2)
    expect(acknowledgements).toBe(2)
})

test('real producer and consumer catch up after an outage exceeding the former window without losing outcomes', async () => {
    let saved: unknown = null
    let counter = 1000
    const id = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`
    const engine = await createManagedBackupEngine({
        read: async () => saved,
        write: async (state) => {
            saved = structuredClone(state)
        },
        now: () => 0,
        id,
        source: () => ({
            imageId: null,
            revision: null,
            version: 'test',
            buildSha256: 'a'.repeat(64),
        }),
        execute: async (job) => ({ id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }),
        verify: async () => true,
        remove: async () => {},
    })
    let completed = 0
    for (let index = 0; index < 200; index++) {
        try {
            await engine.start({ actorId, requestId: id() })
        } catch (error) {
            expect(error).toMatchObject({ code: 'capacity' })
            break
        }
        await engine.tick()
        completed++
    }
    const pending = await engine.status()
    expect(pending.auditEvents.length).toBeGreaterThan(500)
    const store = persistence()
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => engine.status(),
        acknowledge: (cursor) => engine.acknowledgeAudit(cursor),
    })
    while ((await engine.status()).auditEvents.length > 0) await ingest(freshSignal())
    expect(store.audit()).toHaveLength(pending.auditEvents.length)
    expect(store.audit().filter((row) => row.action === 'save')).toHaveLength(completed)
    expect(store.cursor()).toEqual({
        storeId: pending.storeId,
        sequence: pending.auditEvents.at(-1)!.sequence,
    })
    await engine.start({ actorId, requestId: id() })
    await engine.tick()
    await ingest(freshSignal())
    expect(store.audit().filter((row) => row.action === 'save')).toHaveLength(completed + 1)
    expect((await engine.status()).auditEvents).toEqual([])
})

test.each(['append', 'save', 'commit'] as const)(
    'notification queue and audit cursor roll back together on %s failure',
    async (failure) => {
        const store = persistence(notificationConfiguration)
        let acknowledgements = 0
        let changes = 0
        if (failure === 'append') store.failAppend(true)
        else if (failure === 'save') store.failSave(true)
        else store.failCommit(true)
        const ingest = createBackupAuditIngestor({
            transaction: store.transaction,
            status: async () => snapshot([event(1)]),
            acknowledge: async () => {
                acknowledgements++
            },
            changed: () => {
                changes++
            },
        })
        await expect(ingest(freshSignal())).rejects.toThrow()
        expect(store.queue().deliveries).toHaveLength(0)
        expect(store.audit()).toHaveLength(0)
        expect(store.cursor()).toEqual({ storeId: null, sequence: 0 })
        expect(acknowledgements).toBe(0)
        expect(changes).toBe(0)
        store.failAppend(false)
        store.failSave(false)
        store.failCommit(false)
        expect(await ingest(freshSignal())).toBe(1)
        expect(store.queue().deliveries).toHaveLength(1)
        expect(changes).toBe(1)
    },
)

test('queue admission commits before root ACK and realtime invalidation, then ACK retry cannot duplicate', async () => {
    const store = persistence(notificationConfiguration)
    let fail = true
    let changes = 0
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot([event(1)]),
        changed: () => {
            expect(store.queue().deliveries).toHaveLength(1)
            expect(store.audit()).toHaveLength(1)
            changes++
        },
        acknowledge: async (cursor) => {
            expect(store.cursor()).toEqual(cursor)
            expect(store.queue().deliveries).toHaveLength(1)
            if (fail) throw new Error('root unavailable')
        },
    })
    await expect(ingest(freshSignal())).rejects.toThrow('root unavailable')
    const ids = store.queue().deliveries.map((delivery) => delivery.id)
    fail = false
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.queue().deliveries.map((delivery) => delivery.id)).toEqual(ids)
    expect(changes).toBe(1)
    const newStore = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot([event(1)], actorId),
        acknowledge: async () => {},
    })
    expect(await newStore(freshSignal())).toBe(1)
    expect(store.queue().deliveries).toHaveLength(2)
})

test('saturation audits and ACKs only an all-or-nothing notification prefix, then catches up after delivery', async () => {
    const config = {
        ...notificationConfiguration,
        channels: Array.from({ length: 3 }, (_, index) => ({
            ...notificationConfiguration.channels[0]!,
            id: `00000000-0000-4000-8000-${String(50 + index).padStart(12, '0')}`,
        })),
    }
    const store = persistence(config)
    const events = Array.from({ length: 100 }, (_, index) => event(index + 1))
    const acknowledgements: number[] = []
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot(events),
        acknowledge: async (cursor) => {
            acknowledgements.push(cursor.sequence)
        },
    })
    expect(await ingest(freshSignal())).toBe(85)
    expect(store.queue().deliveries).toHaveLength(255)
    expect(store.audit()).toHaveLength(85)
    expect(store.cursor().sequence).toBe(85)
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.audit()).toHaveLength(85)
    store.drainQueue()
    expect(await ingest(freshSignal())).toBe(15)
    expect(store.audit()).toHaveLength(100)
    expect(store.cursor().sequence).toBe(100)
    expect(acknowledgements).toEqual([85, 85, 100])
})

const restoredCursor: BackupAuditCursor = { storeId: null, sequence: 0, restorePending: true }
test('trusted restore marker survives an empty root outbox and strips itself only after accepted history', async () => {
    const store = persistence(notificationConfiguration, restoredCursor)
    let outbox: ManagedBackupAuditEvent[] = []
    const acknowledgements: object[] = []
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot(outbox),
        acknowledge: async (cursor) => {
            acknowledgements.push(cursor)
        },
    })
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.cursor()).toEqual(restoredCursor)
    expect(acknowledgements).toHaveLength(0)
    outbox = [event(151), event(152)]
    expect(await ingest(freshSignal())).toBe(2)
    expect(store.cursor()).toEqual({ storeId, sequence: 152 })
    expect(acknowledgements).toEqual([{ storeId, sequence: 152 }])
    expect(store.queue().deliveries).toHaveLength(2)
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.queue().deliveries).toHaveLength(2)
})

test('restore rebase cannot acknowledge an outcome blocked by queue saturation', async () => {
    const store = persistence(notificationConfiguration, restoredCursor)
    const full = enqueueBackupOutcomeNotifications(
        createNotificationState(),
        notificationConfiguration,
        Array.from({ length: 256 }, (_, index) => event(index + 1)),
        2000,
        (() => {
            let next = 50000
            return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
        })(),
    ).state
    store.seedQueue(full)
    const acknowledgements: object[] = []
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot([event(151)]),
        acknowledge: async (cursor) => {
            acknowledgements.push(cursor)
        },
    })
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.cursor()).toEqual(restoredCursor)
    expect(store.audit()).toHaveLength(0)
    expect(acknowledgements).toHaveLength(0)
    store.drainQueue()
    expect(await ingest(freshSignal())).toBe(1)
    expect(store.cursor()).toEqual({ storeId, sequence: 151 })
    expect(acknowledgements).toEqual([{ storeId, sequence: 151 }])
})

test('restore cursor marker rolls back with audit and queue, then an ACK retry deduplicates committed outcomes', async () => {
    const store = persistence(notificationConfiguration, restoredCursor)
    let failAck = true
    let acknowledgements = 0
    store.failAppend(true)
    const ingest = createBackupAuditIngestor({
        transaction: store.transaction,
        status: async () => snapshot([event(151)]),
        acknowledge: async (cursor) => {
            acknowledgements++
            expect(Object.keys(cursor).toSorted()).toEqual(['sequence', 'storeId'])
            if (failAck) throw new Error('root unavailable')
        },
    })
    await expect(ingest(freshSignal())).rejects.toThrow()
    expect(store.cursor()).toEqual(restoredCursor)
    expect(store.queue().deliveries).toHaveLength(0)
    expect(acknowledgements).toBe(0)
    store.failAppend(false)
    await expect(ingest(freshSignal())).rejects.toThrow('root unavailable')
    expect(store.cursor()).toEqual({ storeId, sequence: 151 })
    const ids = store.queue().deliveries.map((delivery) => delivery.id)
    failAck = false
    expect(await ingest(freshSignal())).toBe(0)
    expect(store.queue().deliveries.map((delivery) => delivery.id)).toEqual(ids)
    expect(store.audit()).toHaveLength(1)
    expect(acknowledgements).toBe(2)
    expect(() => planBackupAuditBatch({ storeId, sequence: 100 }, snapshot([event(151)]))).toThrow(
        'Missing backup audit events',
    )
})
