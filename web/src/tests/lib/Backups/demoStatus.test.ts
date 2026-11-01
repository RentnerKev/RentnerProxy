import { expect, test } from 'bun:test'
import { createDemoBackupStatus, isLocalBackupDemoEnvironment } from '@/lib/Backups/demoStatus.ts'
import { managedBackupStatusSchema } from '@/lib/Backups/validation.ts'

test('demo history follows the backup contract and cannot offer nonexistent archives', () => {
    const now = 1_793_448_000_000
    const status = managedBackupStatusSchema.parse(createDemoBackupStatus(now))
    expect(status.jobs).toHaveLength(18)
    expect(new Set(status.jobs.map((job) => job.id)).size).toBe(18)
    expect(new Set(status.jobs.map((job) => job.requestId)).size).toBe(18)
    expect(status.jobs.filter((job) => ['queued', 'running'].includes(job.state))).toHaveLength(0)
    expect(status.jobs.at(-1)?.state).toBe('succeeded')
    expect(status.jobs.at(-1)?.finishedAt).toBeLessThan(now)
    const completed = status.jobs.filter((job) => job.state === 'succeeded')
    expect(status.jobs.some((job) => job.retained)).toBeFalse()
    expect(completed.some((job) => !job.retained)).toBeTrue()
    expect(status.jobs.some((job) => job.state === 'failed')).toBeTrue()
    expect(status.jobs.some((job) => job.state === 'interrupted')).toBeTrue()
    for (const job of status.jobs) {
        expect(job.requestedAt).toBeLessThan(now)
        if (job.artifact) expect(job.artifact.id).toBe(job.id)
        if (job.state !== 'succeeded') {
            expect(job.retained).toBeFalse()
            expect(job.artifact).toBeNull()
        }
    }
    expect(status.configuration.nextRunAt).toBeGreaterThan(now)
})

test('database demo data is restricted to a loopback development app and database', () => {
    const local = {
        NODE_ENV: 'development',
        APP_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://demo:demo@127.0.0.1:5432/demo',
    }
    expect(isLocalBackupDemoEnvironment(local)).toBeTrue()
    expect(isLocalBackupDemoEnvironment({ ...local, NODE_ENV: 'production' })).toBeFalse()
    expect(isLocalBackupDemoEnvironment({ ...local, APP_URL: 'https://example.test' })).toBeFalse()
    expect(
        isLocalBackupDemoEnvironment({
            ...local,
            DATABASE_URL: 'postgresql://db.example.test/demo',
        }),
    ).toBeFalse()
    expect(isLocalBackupDemoEnvironment({ ...local, DATABASE_URL: 'invalid' })).toBeFalse()
    expect(isLocalBackupDemoEnvironment({ ...local, DATABASE_URL: undefined })).toBeFalse()
})
