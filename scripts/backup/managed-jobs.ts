import {
    managedBackupArtifactSchema,
    managedBackupAuditAcknowledgementSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
    managedBackupStateSchema,
} from '../../web/src/lib/Backups/validation.ts'
import { BACKUP_AUDIT_POLICY } from '../../web/src/config/backups.config.ts'
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

function hasAuditRoom(draft: ManagedBackupState, needed: number) {
    const sequence = draft.auditEvents.at(-1)?.sequence ?? draft.auditAcknowledged ?? 0
    return (
        draft.auditEvents.length + needed <= BACKUP_AUDIT_POLICY.capacity &&
        Number.isSafeInteger(sequence + needed)
    )
}

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
                  auditAcknowledged: 0,
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
        if (!hasAuditRoom(draft, 1)) throw new ManagedBackupError('capacity')
        draft.auditEvents.push({
            sequence: (draft.auditEvents.at(-1)?.sequence ?? draft.auditAcknowledged ?? 0) + 1,
            kind,
            jobId: job?.id ?? null,
            actorId,
            at: dependencies.now(),
        })
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
        // Retention still owns completion capacity after the success record is committed.
        if (executing || draft.jobs.some(active)) throw new ManagedBackupError('busy')
        if (!hasAuditRoom(draft, BACKUP_AUDIT_POLICY.jobEvents))
            throw new ManagedBackupError('capacity')
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
        // Reject work requested during retention before it can wait behind a
        // later state write and become an unintended post-maintenance admission.
        if (executing && !state.jobs.some((job) => job.requestId === request.requestId))
            throw new ManagedBackupError('busy')
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
            // Reserve all lifecycle and worst-case pruning events for accepted work.
            const reserved =
                executing || draft.jobs.some(active) ? BACKUP_AUDIT_POLICY.jobEvents - 1 : 0
            if (!hasAuditRoom(draft, 1 + reserved)) throw new ManagedBackupError('capacity')
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

    async function acknowledgeAudit(input: unknown) {
        const acknowledgement = managedBackupAuditAcknowledgementSchema.parse(input)
        return mutate((draft) => {
            const last = draft.auditEvents.at(-1)?.sequence ?? draft.auditAcknowledged ?? 0
            if (acknowledgement.storeId !== draft.storeId || acknowledgement.sequence > last)
                throw new ManagedBackupError('revision_conflict')
            if (acknowledgement.sequence <= (draft.auditAcknowledged ?? 0)) return
            if (!draft.auditEvents.some((event) => event.sequence === acknowledgement.sequence))
                throw new ManagedBackupError('revision_conflict')
            draft.auditAcknowledged = acknowledgement.sequence
            draft.auditEvents = draft.auditEvents.filter(
                (event) => event.sequence > acknowledgement.sequence,
            )
        })
    }

    function planPruning(replacementId: string) {
        const replacement = state.jobs.find((job) => job.id === replacementId)
        if (!replacement || replacement.state !== 'succeeded')
            throw new ManagedBackupError('recovery_failed')
        const retained = state.jobs.filter(
            (job) => job.state === 'succeeded' && (job.retained || job.id === replacementId),
        )
        if (retained.length <= state.configuration.retentionCount) return null
        const candidate = retained.find((job) => job.id !== replacementId)
        return candidate ? structuredClone({ candidate, replacement }) : null
    }

    // Verification and filesystem deletion must not own the control-plane chain.
    /* eslint-disable no-await-in-loop */
    async function prune(replacementId: string) {
        while (true) {
            await chain
            const planned = planPruning(replacementId)
            if (!planned) return
            try {
                if (!(await dependencies.verify(planned.replacement))) return
                // Controls may commit during verification. Read their committed
                // policy again, then dispatch without yielding between check and call.
                await chain
                const current = planPruning(replacementId)
                if (
                    !current ||
                    current.candidate.id !== planned.candidate.id ||
                    JSON.stringify(current.candidate.artifact) !==
                        JSON.stringify(planned.candidate.artifact) ||
                    JSON.stringify(current.replacement.artifact) !==
                        JSON.stringify(planned.replacement.artifact)
                )
                    return
                await dependencies.remove(current.candidate)
            } catch {
                return
            }
            // Acknowledge each completed removal against fresh state. Concurrent
            // configuration and producer ACKs must never be overwritten by a plan.
            await mutate((draft) => {
                const candidate = draft.jobs.find((job) => job.id === planned.candidate.id)
                const replacement = draft.jobs.find((job) => job.id === replacementId)
                if (
                    !candidate ||
                    candidate.state !== 'succeeded' ||
                    !candidate.retained ||
                    !replacement ||
                    replacement.state !== 'succeeded'
                )
                    throw new ManagedBackupError('recovery_failed')
                candidate.retained = false
                replacement.retained =
                    draft.jobs.filter((job) => job.id !== replacementId && job.retained).length < 50
                audit(draft, 'pruned', candidate)
            })
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
                // A delayed consumer must not drop audit records or strand an accepted job.
                if (!hasAuditRoom(draft, BACKUP_AUDIT_POLICY.jobEvents)) return null
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
                await prune(job.id)
                await mutate((draft) => {
                    const replacement = draft.jobs.find((entry) => entry.id === job.id)
                    if (!replacement || replacement.state !== 'succeeded')
                        throw new ManagedBackupError('recovery_failed')
                    replacement.retained =
                        draft.jobs.filter((entry) => entry.id !== replacement.id && entry.retained)
                            .length < 50
                })
            }
        } finally {
            executing = false
        }
    }

    return { status, start, updateConfiguration, tick, acknowledgeAudit }
}
