import {
    managedBackupArtifactSchema,
    managedBackupAuditAcknowledgementSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
    managedBackupStateSchema,
    managedBackupDeleteSchema,
    managedBackupRestoreSchema,
} from '../../web/src/lib/Backups/validation.ts'
import { BACKUP_AUDIT_POLICY } from '../../web/src/config/backups.config.ts'
import { offHostConfigurationAuditSchema } from '../../web/src/lib/Backups/offHostValidation.ts'
import type {
    ManagedBackupAuditEvent,
    ManagedBackupJob,
    ManagedBackupState,
    ManagedBackupStatus,
    ManagedBackupMaintenance,
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
    let downloadActive = false
    let offHostConfigurationActive = false
    let offHostAuditBlocked = false
    let offHostRecovery: Promise<void> | null = null
    let managedAuditUncertain = false
    const offHostBusy = () =>
        offHostConfigurationActive || offHostAuditBlocked || offHostRecovery !== null

    const maintenanceActive = () =>
        state.maintenance?.state === 'queued' || state.maintenance?.state === 'running'

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

    async function reloadManagedJournal() {
        const durable = await dependencies.read()
        if (durable === null) throw new ManagedBackupError('recovery_failed')
        state = managedBackupStateSchema.parse(durable)
        persisted = true
        managedAuditUncertain = false
    }

    function mutate<T>(
        operation: (draft: ManagedBackupState) => T | Promise<T>,
        recoverAuditWrite = false,
    ): Promise<T> {
        const result = chain.then(async () => {
            if (managedAuditUncertain) await reloadManagedJournal()
            const draft = structuredClone(state)
            const value = await operation(draft)
            managedBackupStateSchema.parse(draft)
            if (!persisted || JSON.stringify(draft) !== JSON.stringify(state)) {
                try {
                    await dependencies.write(structuredClone(draft))
                } catch (error) {
                    if (recoverAuditWrite) {
                        managedAuditUncertain = true
                        await reloadManagedJournal().catch(() => {})
                    }
                    throw error
                }
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

    function reconcileOffHostAudit(): Promise<void> {
        if (!dependencies.offHostAudit) return Promise.resolve()
        if (offHostRecovery) return offHostRecovery
        offHostAuditBlocked = true
        const source = dependencies.offHostAudit
        const recovery = (async () => {
            const pending = await source.pending()
            if (pending) {
                const receipt = offHostConfigurationAuditSchema.parse(pending)
                await mutate((draft) => {
                    const previous = draft.offHostConfigurationAudits?.find(
                        (entry) => entry.requestId === receipt.requestId,
                    )
                    if (previous) {
                        if (
                            previous.actorId !== receipt.actorId ||
                            previous.fingerprint !== receipt.fingerprint
                        )
                            throw new ManagedBackupError('revision_conflict')
                        return
                    }
                    audit(draft, 'off_host_configuration_updated', null, receipt.actorId)
                    draft.offHostConfigurationAudits = [
                        ...(draft.offHostConfigurationAudits ?? []),
                        receipt,
                    ].slice(-100)
                }, true)
                // Both event and deduplication receipt are durable before source ACK.
                await source.acknowledge(receipt)
            }
            offHostAuditBlocked = false
        })()
        offHostRecovery = recovery
        void recovery.then(
            () => {
                offHostRecovery = null
            },
            () => {
                offHostRecovery = null
            },
        )
        return recovery
    }

    // A published archive does not prove that lifecycle recovery completed before a crash.
    await mutate(async (draft) => {
        const operation = draft.maintenance
        if (operation?.state === 'running') {
            if (operation.operation === 'delete') {
                operation.state = 'queued'
                operation.phase = 'queued'
            } else {
                const completed =
                    (await dependencies.recoverRestore?.(structuredClone(operation))) ?? false
                operation.state = completed ? 'succeeded' : 'interrupted'
                operation.error = completed ? null : 'interrupted'
                operation.finishedAt = dependencies.now()
                if (completed) {
                    operation.phase = 'complete'
                    operation.progressPercent = 100
                }
                audit(
                    draft,
                    completed ? 'restore_succeeded' : 'restore_interrupted',
                    draft.jobs.find((job) => job.id === operation.artifactId) ?? null,
                    operation.actorId,
                )
                const receipt = draft.maintenanceRequests?.find(
                    (entry) => entry.id === operation.id,
                )
                if (receipt) Object.assign(receipt, operation)
            }
        }
        for (const job of draft.jobs.filter((entry) => entry.state === 'running')) {
            if (job.remote?.state === 'uploading')
                job.remote = { state: 'failed', error: 'interrupted' }
            job.state = 'interrupted'
            job.error = 'interrupted'
            job.finishedAt = dependencies.now()
            job.durationMs =
                job.startedAt === null ? null : Math.max(0, job.finishedAt - job.startedAt)
            audit(draft, 'interrupted', job)
        }
    })
    // Queue pressure or an unavailable journal must not hide status/audit ACK.
    // Keep backup mutations fenced until this durable source outbox is drained.
    await reconcileOffHostAudit().catch(() => {})

    async function admit(
        draft: ManagedBackupState,
        requestId: string,
        actorId: string | null,
        scheduledFor: number | null,
    ) {
        // Retention still owns completion capacity after the success record is committed.
        if (
            offHostBusy() ||
            executing ||
            downloadActive ||
            maintenanceActive() ||
            draft.jobs.some(active)
        )
            throw new ManagedBackupError('busy')
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
            maintenance: state.maintenance ?? null,
        })
    }

    async function start(input: unknown) {
        const request = managedBackupStartSchema.parse(input)
        // Reject work requested during retention before it can wait behind a
        // later state write and become an unintended post-maintenance admission.
        if (
            (offHostBusy() || executing) &&
            !state.jobs.some((job) => job.requestId === request.requestId)
        )
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

    async function requestMaintenance(id: string, input: unknown, operation: 'delete' | 'restore') {
        const request = (
            operation === 'restore' ? managedBackupRestoreSchema : managedBackupDeleteSchema
        ).parse(input)
        const actorName =
            operation === 'restore' ? managedBackupRestoreSchema.parse(input).actorName : null
        if (
            (offHostBusy() || executing || downloadActive) &&
            !state.maintenanceRequests?.some((entry) => entry.requestId === request.requestId)
        )
            throw new ManagedBackupError('busy')
        return mutate(async (draft) => {
            const previous = draft.maintenanceRequests?.find(
                (entry) => entry.requestId === request.requestId,
            )
            if (previous) {
                if (
                    previous.artifactId !== id ||
                    previous.actorId !== request.actorId ||
                    previous.metadataSha256 !== request.metadataSha256 ||
                    previous.operation !== operation ||
                    previous.actorName !== actorName
                )
                    throw new ManagedBackupError('revision_conflict')
                return previous
            }
            if (
                offHostBusy() ||
                executing ||
                downloadActive ||
                maintenanceActive() ||
                draft.jobs.some(active)
            )
                throw new ManagedBackupError('busy')
            const job = draft.jobs.find((entry) => entry.id === id)
            if (
                !job ||
                active(job) ||
                (job.artifact?.metadataSha256 ?? null) !== request.metadataSha256 ||
                (operation === 'restore' &&
                    (job.state !== 'succeeded' || !job.retained || job.artifact?.id !== id))
            )
                throw new ManagedBackupError('artifact_invalid')
            if (!hasAuditRoom(draft, 4)) throw new ManagedBackupError('capacity')
            const receipt: ManagedBackupMaintenance = {
                id: dependencies.id(),
                requestId: request.requestId,
                actorId: request.actorId,
                actorName,
                artifactId: id,
                metadataSha256: request.metadataSha256,
                operation,
                state: 'queued',
                phase: 'queued',
                progressPercent: 0,
                requestedAt: dependencies.now(),
                startedAt: null,
                finishedAt: null,
                error: null,
            }
            draft.maintenance = receipt
            draft.maintenanceRequests = [
                ...(draft.maintenanceRequests ?? []),
                structuredClone(receipt),
            ].slice(-100)
            audit(
                draft,
                operation === 'restore' ? 'restore_requested' : 'delete_requested',
                job,
                request.actorId,
            )
            return receipt
        })
    }

    async function runMaintenance(): Promise<boolean> {
        const operation = await mutate((draft) => {
            if (
                offHostBusy() ||
                executing ||
                downloadActive ||
                draft.maintenance?.state !== 'queued'
            )
                return null
            draft.maintenance.state = 'running'
            draft.maintenance.startedAt = dependencies.now()
            draft.maintenance.phase = 'validating'
            const job = draft.jobs.find((entry) => entry.id === draft.maintenance!.artifactId)
            if (!job) throw new ManagedBackupError('artifact_invalid')
            if (draft.maintenance.operation === 'restore')
                audit(draft, 'restore_started', job, draft.maintenance.actorId)
            return { operation: draft.maintenance, job }
        })
        if (!operation) return false
        executing = true
        let error: ManagedBackupMaintenance['error'] = null
        try {
            if (
                (operation.operation.operation === 'restore' || operation.job.retained) &&
                !(await dependencies.verify(operation.job)) &&
                !(
                    operation.operation.operation === 'delete' &&
                    (await dependencies.removed?.(operation.job))
                )
            )
                throw new ManagedBackupError('artifact_invalid')
            if (operation.operation.operation === 'delete') {
                if (operation.job.retained) await dependencies.remove(operation.job)
            } else {
                if (!dependencies.restore) throw new ManagedBackupError('execution_failed')
                await dependencies.restore(
                    operation.job,
                    operation.operation,
                    async (phase, percent) => {
                        await mutate((draft) => {
                            const current = draft.maintenance
                            if (
                                !current ||
                                current.id !== operation.operation.id ||
                                current.state !== 'running'
                            )
                                throw new ManagedBackupError('recovery_failed')
                            if (percent < current.progressPercent || percent >= 100)
                                throw new ManagedBackupError('recovery_failed')
                            current.phase = phase
                            current.progressPercent = percent
                        })
                    },
                )
            }
        } catch (cause) {
            error =
                cause instanceof ManagedBackupError &&
                ['artifact_invalid', 'recovery_failed'].includes(cause.code)
                    ? (cause.code as 'artifact_invalid' | 'recovery_failed')
                    : 'execution_failed'
        }
        try {
            await mutate((draft) => {
                const current = draft.maintenance
                if (!current || current.id !== operation.operation.id)
                    throw new ManagedBackupError('recovery_failed')
                current.state = error === null ? 'succeeded' : 'failed'
                current.error = error
                current.finishedAt = dependencies.now()
                if (error === null) {
                    current.phase = 'complete'
                    current.progressPercent = 100
                }
                const job = draft.jobs.find((entry) => entry.id === current.artifactId)
                if (error === null && current.operation === 'delete' && job) job.retained = false
                audit(
                    draft,
                    current.operation === 'delete'
                        ? error === null
                            ? 'deleted'
                            : 'delete_failed'
                        : error === null
                          ? 'restore_succeeded'
                          : 'restore_failed',
                    job ?? null,
                    current.actorId,
                )
                if (error === null && current.operation === 'delete')
                    draft.jobs = draft.jobs.filter((entry) => entry.id !== current.artifactId)
                const receipt = draft.maintenanceRequests?.find((entry) => entry.id === current.id)
                if (receipt) Object.assign(receipt, current)
            })
        } finally {
            executing = false
        }
        return true
    }

    async function acquireDownload() {
        await mutate((draft) => {
            if (
                offHostBusy() ||
                executing ||
                downloadActive ||
                maintenanceActive() ||
                draft.jobs.some(active)
            )
                throw new ManagedBackupError('busy')
            downloadActive = true
        })
        let released = false
        return () => {
            if (!released) {
                released = true
                downloadActive = false
            }
        }
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
            if (offHostBusy()) throw new ManagedBackupError('busy')
            // Reserve all lifecycle and worst-case pruning events for accepted work.
            const reserved =
                executing || draft.jobs.some(active)
                    ? BACKUP_AUDIT_POLICY.jobEvents - 1
                    : maintenanceActive()
                      ? 4
                      : 0
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
        await mutate((draft) => {
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
        if (offHostAuditBlocked && !offHostConfigurationActive && !offHostRecovery)
            await reconcileOffHostAudit().catch(() => {})
    }

    async function configureOffHost(configure: () => Promise<void>) {
        if (
            offHostConfigurationActive ||
            offHostRecovery ||
            executing ||
            downloadActive ||
            maintenanceActive() ||
            state.jobs.some(active)
        )
            throw new ManagedBackupError('busy')
        if (!dependencies.offHostAudit) throw new ManagedBackupError('recovery_failed')
        offHostConfigurationActive = true
        try {
            await reconcileOffHostAudit()
            await mutate((draft) => {
                if (executing || downloadActive || maintenanceActive() || draft.jobs.some(active))
                    throw new ManagedBackupError('busy')
                if (!hasAuditRoom(draft, 1)) throw new ManagedBackupError('capacity')
            })
            try {
                await configure()
            } finally {
                // A target write may have committed even when its fsync threw.
                await reconcileOffHostAudit()
            }
        } finally {
            offHostConfigurationActive = false
        }
    }

    function planPruning(replacementId: string) {
        const replacement = state.jobs.find((job) => job.id === replacementId)
        if (!replacement || replacement.state !== 'succeeded')
            throw new ManagedBackupError('recovery_failed')
        const retained = state.jobs.filter(
            (job) => job.state === 'succeeded' && (job.retained || job.id === replacementId),
        )
        // An upload outage keeps its last remote-verified local point alongside
        // the fresh local replacement without accumulating every failed upload.
        const pinned =
            replacement.remote?.state === 'failed'
                ? retained.findLast((job) => job.retained && job.remote?.state === 'succeeded')
                : undefined
        const keep = Math.max(state.configuration.retentionCount, pinned ? 2 : 1)
        if (retained.length <= keep) return null
        const candidate = retained.find((job) => job.id !== replacementId && job.id !== pinned?.id)
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

    async function recoverRestartedRestore(): Promise<boolean> {
        await chain
        const operation = state.maintenance
        if (
            executing ||
            downloadActive ||
            offHostBusy() ||
            !dependencies.recoverRestore ||
            operation?.operation !== 'restore' ||
            operation.phase !== 'restarting' ||
            operation.progressPercent < 90 ||
            (operation.state !== 'failed' && operation.state !== 'interrupted')
        )
            return false
        executing = true
        try {
            // Keep scheduled work paused while the supervisor is proving this boot ready.
            if (!(await dependencies.recoverRestore(structuredClone(operation)))) return true
            await mutate((draft) => {
                const current = draft.maintenance
                if (
                    !current ||
                    current.id !== operation.id ||
                    current.phase !== 'restarting' ||
                    (current.state !== 'failed' && current.state !== 'interrupted')
                )
                    throw new ManagedBackupError('recovery_failed')
                current.state = 'succeeded'
                current.error = null
                current.phase = 'complete'
                current.progressPercent = 100
                current.finishedAt = dependencies.now()
                audit(
                    draft,
                    'restore_succeeded',
                    draft.jobs.find((job) => job.id === current.artifactId) ?? null,
                    current.actorId,
                )
                const receipt = draft.maintenanceRequests?.find((entry) => entry.id === current.id)
                if (receipt) Object.assign(receipt, current)
            })
            return true
        } finally {
            executing = false
        }
    }

    async function tick() {
        if (await recoverRestartedRestore()) return
        if (offHostAuditBlocked && !offHostConfigurationActive && !offHostRecovery)
            await reconcileOffHostAudit().catch(() => {})
        if (offHostBusy()) return
        if (await runMaintenance()) return
        const job = await mutate(async (draft) => {
            if (
                executing ||
                offHostBusy() ||
                downloadActive ||
                maintenanceActive() ||
                draft.jobs.some((entry) => entry.state === 'running')
            )
                return null
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
            let remote: ManagedBackupJob['remote'] = null
            let error: ManagedBackupJob['error'] = null
            try {
                artifact = managedBackupArtifactSchema.parse(
                    await dependencies.execute(structuredClone(job)),
                )
                if (!(await dependencies.verify({ ...job, artifact }))) error = 'artifact_invalid'
                if (error === null && dependencies.replicate) {
                    await mutate((draft) => {
                        const current = draft.jobs.find((entry) => entry.id === job.id)
                        if (!current) throw new ManagedBackupError('capacity')
                        current.remote = { state: 'uploading' }
                    })
                    try {
                        remote = await dependencies.replicate(
                            { ...job, artifact },
                            state.configuration.retentionCount,
                        )
                    } catch {
                        remote = { state: 'failed', error: 'upload_failed' }
                    }
                }
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
                completed.remote = remote
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

    return {
        status,
        start,
        updateConfiguration,
        tick,
        acknowledgeAudit,
        requestMaintenance,
        acquireDownload,
        configureOffHost,
        retentionCount: () => state.configuration.retentionCount,
    }
}
