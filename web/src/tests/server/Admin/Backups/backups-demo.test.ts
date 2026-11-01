import { expect, test } from 'bun:test'
import { createDemoBackupStatus } from '@/lib/Backups/demoStatus.ts'
import { managedBackupStatusSchema } from '@/lib/Backups/validation.ts'
import { applyLocalBackupDemoDelete } from '@/server/Admin/Backups/backups-demo.server.ts'
import type { DeleteLocalBackupDemoInput } from '@/server/Admin/Backups/backups-demo.server.ts'

const now = 1_793_448_000_000
const actorId = '01900000-0000-7000-8000-000000000900'
const requestId = '01900000-0000-7000-8000-000000000800'

function fixture() {
    const status = createDemoBackupStatus(now)
    const job = status.jobs[0]!
    const input: DeleteLocalBackupDemoInput = {
        actorId,
        requestId,
        jobId: job.id,
        metadataSha256: job.artifact?.metadataSha256 ?? null,
    }
    return { status, input }
}

test('demo deletion removes one history entry and preserves all other inventory and schedule data', () => {
    const { status, input } = fixture()
    const before = structuredClone(status)
    const saved = applyLocalBackupDemoDelete(status, input, now)
    expect(managedBackupStatusSchema.safeParse(saved).success).toBeTrue()
    expect(saved.jobs).toEqual(before.jobs.filter((job) => job.id !== input.jobId))
    expect(saved.jobs.at(-1)).toEqual(before.jobs.at(-1))
    expect(saved.configuration).toEqual(before.configuration)
    expect(saved.auditEvents).toEqual(before.auditEvents)
    expect(saved.storeId).toBe(before.storeId)
    expect(status).toEqual(before)
    expect(saved.maintenance).toMatchObject({
        requestId,
        actorId,
        artifactId: input.jobId,
        operation: 'delete',
        state: 'succeeded',
        phase: 'complete',
        progressPercent: 100,
        finishedAt: now,
    })
})

test('repeating the same deletion returns its receipt without another mutation', () => {
    const { status, input } = fixture()
    const saved = applyLocalBackupDemoDelete(status, input, now)
    expect(applyLocalBackupDemoDelete(saved, input, now + 1000)).toBe(saved)
    for (const conflicting of [
        { ...input, actorId: status.storeId },
        { ...input, jobId: status.jobs[1]!.id },
        { ...input, metadataSha256: 'e'.repeat(64) },
    ])
        expect(() => applyLocalBackupDemoDelete(saved, conflicting, now)).toThrow(
            'revision_conflict',
        )
})

test('demo deletion rejects unknown targets, malformed IDs and changed metadata', () => {
    const { status, input } = fixture()
    expect(() => applyLocalBackupDemoDelete(status, { ...input, jobId: actorId }, now)).toThrow(
        'revision_conflict',
    )
    expect(() => applyLocalBackupDemoDelete(status, { ...input, jobId: '../other' }, now)).toThrow(
        'invalid_input',
    )
    expect(() =>
        applyLocalBackupDemoDelete(status, { ...input, metadataSha256: null }, now),
    ).toThrow('revision_conflict')
    expect(() =>
        applyLocalBackupDemoDelete(status, { ...input, metadataSha256: 'e'.repeat(64) }, now),
    ).toThrow('revision_conflict')
})

test('failed and interrupted demo history can be removed without an archive', () => {
    for (const state of ['failed', 'interrupted'] as const) {
        const status = createDemoBackupStatus(now)
        const job = status.jobs.find((entry) => entry.state === state)!
        const saved = applyLocalBackupDemoDelete(
            status,
            {
                actorId,
                requestId,
                jobId: job.id,
                metadataSha256: null,
            },
            now,
        )
        expect(saved.jobs).toHaveLength(status.jobs.length - 1)
        expect(saved.jobs.some((entry) => entry.id === job.id)).toBeFalse()
    }
})

test('demo deletion refuses all active backup and maintenance operations and real retained archives', () => {
    for (const state of ['queued', 'running'] as const) {
        const { status, input } = fixture()
        status.jobs[1]!.state = state
        expect(() => applyLocalBackupDemoDelete(status, input, now)).toThrow('busy')
        status.jobs[1]!.state = 'succeeded'
        status.jobs[0]!.state = state
        expect(() => applyLocalBackupDemoDelete(status, input, now)).toThrow('busy')
        status.jobs[0]!.state = 'succeeded'
        const receipt = applyLocalBackupDemoDelete(status, input, now).maintenance!
        status.maintenance = { ...receipt, requestId: actorId, state }
        expect(() => applyLocalBackupDemoDelete(status, input, now)).toThrow('busy')
    }
    const { status, input } = fixture()
    status.jobs[0]!.retained = true
    expect(() => applyLocalBackupDemoDelete(status, input, now)).toThrow('unavailable')
})
