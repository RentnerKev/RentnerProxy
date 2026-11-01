import type { ManagedBackupJob, ManagedBackupStatus } from './Types/backups.types.ts'

const uuid = (value: number) => `01900000-0000-7000-8000-${String(value).padStart(12, '0')}`

function isLoopbackUrl(value: string | undefined): boolean {
    if (!value) return false
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)
    } catch {
        return false
    }
}

export function isLocalBackupDemoEnvironment(environment: NodeJS.ProcessEnv): boolean {
    return (
        environment.NODE_ENV === 'development' &&
        isLoopbackUrl(environment.APP_URL) &&
        isLoopbackUrl(environment.DATABASE_URL)
    )
}

export function createDemoBackupStatus(now = Date.now()): ManagedBackupStatus {
    const retentionCount = 7
    const jobs = Array.from({ length: 18 }, (_, index): ManagedBackupJob => {
        const state = index % 7 === 2 ? 'failed' : index % 7 === 4 ? 'interrupted' : 'succeeded'
        const requestedAt = now - (index === 17 ? 90_000 : (18 - index) * 86_400_000)
        const durationMs = 31_000 + index * 2_100
        const origin = index % 4 === 0 ? 'manual' : 'schedule'
        return {
            id: uuid(index + 1),
            requestId: uuid(index + 101),
            origin,
            actorId: origin === 'manual' ? uuid(900) : null,
            scheduledFor: origin === 'schedule' ? requestedAt : null,
            state,
            requestedAt,
            startedAt: requestedAt + 1_000,
            finishedAt: durationMs === null ? null : requestedAt + 1_000 + durationMs,
            durationMs,
            error:
                state === 'failed'
                    ? 'execution_failed'
                    : state === 'interrupted'
                      ? 'interrupted'
                      : null,
            source: {
                imageId: null,
                revision: (index < 9 ? 'a' : 'b').repeat(40),
                version: index < 9 ? '0.0.0-demo.1' : '0.0.0-demo.2',
                buildSha256: 'c'.repeat(64),
            },
            artifact:
                state === 'succeeded'
                    ? {
                          id: uuid(index + 1),
                          metadataSha256: 'd'.repeat(64),
                          bytes: (240 + index * 13) * 1_048_576,
                      }
                    : null,
            retained: false,
        }
    })
    // Synthetic jobs have no real archives and must never offer a download.
    return {
        storeId: uuid(999),
        configuration: {
            revision: 3,
            enabled: true,
            intervalHours: 24,
            retentionCount,
            nextRunAt: now + 6 * 3_600_000,
        },
        jobs,
        auditEvents: [],
    }
}
