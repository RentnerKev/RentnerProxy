import {
    managedBackupArtifactSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
    managedBackupStateSchema,
} from '../../web/src/lib/Backups/validation.ts'
import type {
    ManagedBackupAuditEvent,
    ManagedBackupJob,
    ManagedBackupState,
    ManagedBackupStatus,
} from '../../web/src/lib/Backups/Types/backups.types.ts'
import type {
    ManagedBackupDependencies,
    ManagedBackupErrorCode,
} from './Types/managed-jobs.types.ts'

export class ManagedBackupError extends Error {
    constructor(readonly code: ManagedBackupErrorCode) {
        super(code)
        this.name = 'ManagedBackupError'
    }
}

const active = (job: ManagedBackupJob) => job.state === 'queued' || job.state === 'running'
const interval = (hours: number) => hours * 60 * 60 * 1000

function trim(draft: ManagedBackupState, limit = 100) {
    // A verified replacement may exceed the retained-record cap when pruning fails.
    // Keep its ownership record until a newer successful recovery point exists.
    const latestSuccess = draft.jobs.findLast(
        (job) => job.state === 'succeeded' && job.artifact !== null,
    )
    while (draft.jobs.length > limit) {
        const index = draft.jobs.findIndex(
            (job) => !active(job) && !job.retained && job.id !== latestSuccess?.id,
        )
        if (index < 0) throw new ManagedBackupError('capacity')
        draft.jobs.splice(index, 1)
    }
}

export async function createManagedBackupEngine(dependencies: ManagedBackupDependencies) {
    const loaded = await dependencies.read()
    let state: ManagedBackupState =
        loaded === null
            ? {
                  version: 1,
                  storeId: dependencies.id(),
                  configuration: {
                      revision: 0,
                      enabled: false,
                      intervalHours: 24,
                      retentionCount: 7,
                      nextRunAt: null,
                  },
                  jobs: [],
                  auditEvents: [],
                  configurationRequests: [],
              }
            : managedBackupStateSchema.parse(loaded)
    let persisted = loaded !== null
    let chain = Promise.resolve()
    let executing = false

    function audit(
        draft: ManagedBackupState,
        kind: ManagedBackupAuditEvent['kind'],
        job: ManagedBackupJob | null,
        actorId: string | null = job?.actorId ?? null,
    ) {
        draft.auditEvents.push({
            sequence: (draft.auditEvents.at(-1)?.sequence ?? 0) + 1,
            kind,
            jobId: job?.id ?? null,
            actorId,
            at: dependencies.now(),
        })
        draft.auditEvents = draft.auditEvents.slice(-500)
    }

    function mutate<T>(operation: (draft: ManagedBackupState) => T | Promise<T>): Promise<T> {
        const result = chain.then(async () => {
            const draft = structuredClone(state)
            const value = await operation(draft)
            managedBackupStateSchema.parse(draft)
            if (!persisted || JSON.stringify(draft) !== JSON.stringify(state)) {
                await dependencies.write(structuredClone(draft))
                persisted = true
            }
            state = draft
            return structuredClone(value)
        })
        chain = result.then(
            () => {},
            () => {},
        )
        return result
    }

    // A published archive does not prove that lifecycle recovery completed before a crash.
    await mutate((draft) => {
        for (const job of draft.jobs.filter((entry) => entry.state === 'running')) {
            job.state = 'interrupted'
            job.error = 'interrupted'
            job.finishedAt = dependencies.now()
            job.durationMs =
                job.startedAt === null ? null : Math.max(0, job.finishedAt - job.startedAt)
            audit(draft, 'interrupted', job)
        }
    })

    async function admit(
        draft: ManagedBackupState,
        requestId: string,
        actorId: string | null,
        scheduledFor: number | null,
    ) {
        if (draft.jobs.some(active)) throw new ManagedBackupError('busy')
        trim(draft, 99)
        const job: ManagedBackupJob = {
            id: dependencies.id(),
            requestId,
            actorId,
            origin: scheduledFor === null ? 'manual' : 'schedule',
            scheduledFor,
            state: 'queued',
            requestedAt: dependencies.now(),
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            error: null,
            source: managedBackupSourceSchema.parse(await dependencies.source()),
            artifact: null,
            retained: false,
        }
        draft.jobs.push(job)
        audit(draft, 'requested', job)
        return job
    }

    async function status(): Promise<ManagedBackupStatus> {
        await chain
        return structuredClone({
            configuration: state.configuration,
            jobs: state.jobs,
            storeId: state.storeId,
            auditEvents: state.auditEvents,
        })
    }

    async function start(input: unknown) {
        const request = managedBackupStartSchema.parse(input)
        return mutate(async (draft) => {
            const previous = draft.jobs.find((job) => job.requestId === request.requestId)
            if (previous) {
                if (previous.origin !== 'manual' || previous.actorId !== request.actorId)
                    throw new ManagedBackupError('revision_conflict')
                return previous
            }
            return admit(draft, request.requestId, request.actorId, null)
        })
    }

    async function updateConfiguration(input: unknown) {
        const request = managedBackupConfigurationUpdateSchema.parse(input)
        return mutate((draft) => {
            const previous = draft.configurationRequests.find(
                (receipt) => receipt.request.requestId === request.requestId,
            )
            if (previous) {
                if (JSON.stringify(previous.request) !== JSON.stringify(request))
                    throw new ManagedBackupError('revision_conflict')
                return previous.configuration
            }
            const config = draft.configuration
            if (request.expectedRevision !== config.revision)
                throw new ManagedBackupError('revision_conflict')
            const changedSchedule =
                request.enabled !== config.enabled || request.intervalHours !== config.intervalHours
            draft.configuration = {
                revision: config.revision + 1,
                enabled: request.enabled,
                intervalHours: request.intervalHours,
                retentionCount: request.retentionCount,
                nextRunAt: !request.enabled
                    ? null
                    : changedSchedule
                      ? dependencies.now() + interval(request.intervalHours)
                      : config.nextRunAt,
            }
            draft.configurationRequests.push({
                request,
                configuration: structuredClone(draft.configuration),
            })
            draft.configurationRequests = draft.configurationRequests.slice(-100)
            audit(draft, 'configuration_updated', null, request.actorId)
            return draft.configuration
        })
    }

    // Retention must verify and remove each point in order, preserving a verified replacement.
    /* eslint-disable no-await-in-loop */
    async function prune(draft: ManagedBackupState, replacement: ManagedBackupJob) {
        const retained = draft.jobs.filter(
            (job) => job.state === 'succeeded' && (job.retained || job.id === replacement.id),
        )
        const excess = retained.length - draft.configuration.retentionCount
        for (const candidate of retained
            .filter((job) => job.id !== replacement.id)
            .slice(0, Math.max(0, excess))) {
            // Reverify immediately before every deletion; failed/interrupted jobs are never candidates.
            try {
                if (!(await dependencies.verify(structuredClone(replacement)))) return
                await dependencies.remove(structuredClone(candidate))
            } catch {
                return
            }
            candidate.retained = false
            audit(draft, 'pruned', candidate)
        }
    }

    /* eslint-enable no-await-in-loop */

    async function tick() {
        const job = await mutate(async (draft) => {
            if (executing || draft.jobs.some((entry) => entry.state === 'running')) return null
            let queued = draft.jobs.find((entry) => entry.state === 'queued')
            const config = draft.configuration
            const now = dependencies.now()
            if (!queued && config.enabled && config.nextRunAt !== null && config.nextRunAt <= now) {
                const due = config.nextRunAt
                queued = await admit(draft, dependencies.id(), null, due)
                config.nextRunAt =
                    due +
                    (Math.floor((now - due) / interval(config.intervalHours)) + 1) *
                        interval(config.intervalHours)
            }
            if (!queued) return null
            queued.state = 'running'
            queued.startedAt = now
            audit(draft, 'started', queued)
            return queued
        })
        if (!job) return
        executing = true
        try {
            let artifact: ManagedBackupJob['artifact'] = null
            let error: ManagedBackupJob['error'] = null
            try {
                artifact = managedBackupArtifactSchema.parse(
                    await dependencies.execute(structuredClone(job)),
                )
                if (!(await dependencies.verify({ ...job, artifact }))) error = 'artifact_invalid'
            } catch (cause) {
                error =
                    cause instanceof ManagedBackupError &&
                    (cause.code === 'artifact_invalid' || cause.code === 'recovery_failed')
                        ? cause.code
                        : 'execution_failed'
            }
            await mutate(async (draft) => {
                const completed = draft.jobs.find((entry) => entry.id === job.id)
                if (!completed) throw new ManagedBackupError('capacity')
                completed.artifact = artifact
                completed.state = error === null ? 'succeeded' : 'failed'
                completed.error = error
                completed.finishedAt = dependencies.now()
                completed.durationMs = Math.max(
                    0,
                    completed.finishedAt - (completed.startedAt ?? completed.requestedAt),
                )
                // The hard retained-record bound never authorizes deleting an unverified recovery point.
                completed.retained =
                    error === null && draft.jobs.filter((entry) => entry.retained).length < 50
                audit(draft, error === null ? 'succeeded' : 'failed', completed)
                trim(draft)
            })
            // Commit the verified recovery point before any old artifact can be removed.
            if (error === null) {
                await mutate(async (draft) => {
                    const replacement = draft.jobs.find((entry) => entry.id === job.id)
                    if (!replacement || replacement.state !== 'succeeded')
                        throw new ManagedBackupError('recovery_failed')
                    await prune(draft, replacement)
                    replacement.retained =
                        draft.jobs.filter((entry) => entry.id !== replacement.id && entry.retained)
                            .length < 50
                })
            }
        } finally {
            executing = false
        }
    }

    return { status, start, updateConfiguration, tick }
}
