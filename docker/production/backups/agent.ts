// oxlint-disable no-await-in-loop -- Poll one supervisor result and inspect fixed owned files sequentially.
import { randomUUID } from 'node:crypto'
import { chmod, chown, lstat, opendir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
    createManagedBackupEngine,
    ManagedBackupError,
} from '../../../scripts/backup/managed-jobs.ts'
import { syncBackupDirectory, verifyPublishedBackup } from '../../../scripts/backup/publication.ts'
import { parseBackupMetadata } from '../../../scripts/backup/format.ts'
import { createBackupDownload } from './download.ts'
import { writeMaintenanceProgress } from './restore.ts'
import { createOffHostBackupService, cleanupOffHostTemporaryFiles } from './off-host.ts'
import { offHostConfigurationUpdateSchema } from '../../../web/src/lib/Backups/offHostValidation.ts'
import {
    managedBackupArtifactSchema,
    managedBackupAuditAcknowledgementSchema,
    managedBackupStateSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
    managedBackupDeleteSchema,
    managedBackupRestoreSchema,
} from '../../../web/src/lib/Backups/validation.ts'
import type {
    ManagedBackupArtifact,
    ManagedBackupJob,
} from '../../../web/src/lib/Backups/Types/backups.types.ts'
import {
    artifactsRoot,
    backupRoot,
    controlRoot,
    privateDirectory,
    readPrivateJson,
    sourceFile,
    stateFile,
    writePrivateJson,
} from './storage.ts'

type Engine = Awaited<ReturnType<typeof createManagedBackupEngine>>
const resultSchema = z.strictObject({
    id: z.uuid(),
    success: z.boolean(),
    error: z.enum(['execution_failed', 'recovery_failed']).optional(),
})
const artifactNames = [
    'app-encryption-key',
    'postgres.dump',
    'controller-state.tar',
    'crowdsec-state.tar',
    'metadata.json',
]
const requestFile = join(controlRoot, 'request.json')
const resultFile = join(controlRoot, 'result.json')
const activeFile = join(controlRoot, 'active.json')
const identitySchema = z.strictObject({ id: z.uuid(), kind: z.literal('restore').optional() })

function missing(error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

class UnsafeBackupArtifact extends Error {}

async function boundedDirectoryEntries(directory: string, maximum: number) {
    const entries: string[] = []
    const handle = await opendir(directory)
    for await (const entry of handle) {
        if (entries.length >= maximum) throw new UnsafeBackupArtifact('too many backup entries')
        entries.push(entry.name)
    }
    return entries
}

async function inspectOwnedArtifactDirectory(directory: string, partial: boolean) {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new UnsafeBackupArtifact('invalid backup directory')
    const entries = await boundedDirectoryEntries(directory, artifactNames.length)
    if (
        (!partial && entries.length !== artifactNames.length) ||
        entries.some((name) => !artifactNames.includes(name))
    )
        throw new UnsafeBackupArtifact('invalid backup entries')
    for (const name of entries) {
        const file = await lstat(join(directory, name))
        if (
            !file.isFile() ||
            file.isSymbolicLink() ||
            file.nlink !== 1 ||
            file.uid !== 0 ||
            (file.mode & 0o077) !== 0
        )
            throw new UnsafeBackupArtifact('invalid backup file')
    }
    return directory
}

async function ownedArtifactDirectory(id: string, staging = false, root = artifactsRoot) {
    z.uuid().parse(id)
    return inspectOwnedArtifactDirectory(join(root, (staging ? '.staging-' : '') + id), staging)
}

function canonicalUuid(value: string) {
    return value === value.toLowerCase() && z.uuid().safeParse(value).success
}

async function stageBackupDisposal(directory: string, root: string, deletionId: string) {
    if (!canonicalUuid(deletionId)) throw new UnsafeBackupArtifact('invalid deletion receipt')
    const receipt = join(root, '.deleting-' + deletionId)
    try {
        await lstat(receipt)
        throw new UnsafeBackupArtifact('backup deletion receipt already exists')
    } catch (error) {
        if (!missing(error)) throw error
    }
    // Preserve any existing receipt inode. The exclusive agent owns this
    // root-private namespace, so the checked rename cannot race another job.
    await rename(directory, receipt)
    await syncBackupDirectory(root)
    return receipt
}

export async function reconcileBackupArtifacts(
    jobs: ManagedBackupJob[],
    root = artifactsRoot,
    disposal = {
        id: (): string => randomUUID(),
        remove: (directory: string) => rm(directory, { recursive: true }),
        verifyReplacement: async (job: ManagedBackupJob) => {
            try {
                const artifact = await artifactFor(job, root)
                return (
                    artifact.id === job.artifact?.id &&
                    artifact.metadataSha256 === job.artifact.metadataSha256 &&
                    artifact.bytes === job.artifact.bytes
                )
            } catch {
                return false
            }
        },
    },
) {
    const journal = new Map(jobs.map((job) => [job.id, job]))
    const newestSuccessful = jobs.findLastIndex(
        (job) => job.state === 'succeeded' && job.artifact?.id === job.id,
    )
    // The producer caps its store at 64 entries. Bound even inspection of a
    // damaged/foreign-filled store without reading every payload or retained point.
    for (const name of await boundedDirectoryEntries(root, 128)) {
        if (name.startsWith('.deleting-')) {
            if (!canonicalUuid(name.slice('.deleting-'.length))) continue
            // The durable rename records ownership before files are unlinked.
            // Recovery no longer depends on metadata surviving a partial rm.
            const directory = await inspectOwnedArtifactDirectory(join(root, name), true)
            await syncBackupDirectory(root)
            await disposal.remove(directory)
            await syncBackupDirectory(root)
            continue
        }
        const staging = name.startsWith('.staging-')
        const id = staging ? name.slice('.staging-'.length) : name
        if (!canonicalUuid(id)) continue
        const job = journal.get(id)
        if (job?.state === 'queued' || job?.state === 'running') continue
        if (
            !staging &&
            job?.state === 'succeeded' &&
            (job.retained || jobs.indexOf(job) >= newestSuccessful)
        )
            continue
        let directory: string
        try {
            directory = await inspectOwnedArtifactDirectory(join(root, name), job !== undefined)
        } catch (error) {
            if (missing(error)) continue
            // Journal identity is stronger evidence than the reserved orphan
            // namespace: a referenced unsafe directory blocks cleanup/export.
            if (!job && error instanceof UnsafeBackupArtifact) continue
            throw error
        }
        if (!job) {
            try {
                const metadata = parseBackupMetadata(
                    await readPrivateJson(join(directory, 'metadata.json'), 65_536),
                )
                managedBackupSourceSchema.parse(metadata.source)
            } catch (error) {
                // Only the managed production format establishes orphan
                // ownership. Legacy backups and unrelated contents stay put.
                if (error instanceof Error && 'code' in error && !missing(error)) throw error
                continue
            }
        }
        if (!staging && job?.state === 'succeeded') {
            const replacement = jobs[newestSuccessful]
            if (!replacement || !(await disposal.verifyReplacement(replacement))) continue
        }
        // Uncommitted publication cleanup never changes success/history or
        // authorizes pruning the last retained successful recovery point.
        const receipt = await stageBackupDisposal(directory, root, disposal.id())
        await disposal.remove(receipt)
        await syncBackupDirectory(root)
    }
}

async function artifactFor(job: ManagedBackupJob, root = artifactsRoot) {
    const directory = await ownedArtifactDirectory(job.id, false, root)
    const verified = await verifyPublishedBackup(directory)
    const source = managedBackupSourceSchema.parse(verified.metadata.source)
    if (JSON.stringify(source) !== JSON.stringify(job.source))
        throw new ManagedBackupError('artifact_invalid')
    return { id: job.id, metadataSha256: verified.metadataSha256, bytes: verified.bytes }
}

export async function recoverManagedBackupState(
    input: unknown,
    discover: (job: ManagedBackupJob) => Promise<ManagedBackupArtifact> = artifactFor,
) {
    const state = managedBackupStateSchema.parse(input)
    for (const job of state.jobs) {
        if (job.state !== 'running') continue
        try {
            const artifact = managedBackupArtifactSchema.parse(await discover(job))
            if (artifact.id !== job.id) throw new ManagedBackupError('artifact_invalid')
            job.artifact = artifact
            job.retained = false
        } catch (error) {
            // Missing or invalid publication is not completion proof. Unexpected filesystem
            // failures remain fatal rather than disguising storage failure as interruption.
            if (
                error instanceof Error &&
                'code' in error &&
                !(error instanceof ManagedBackupError) &&
                !missing(error)
            )
                throw error
        }
    }
    return state
}

export async function loadManagedBackupState(
    io = {
        read: () => readPrivateJson(stateFile),
        entries: () => boundedDirectoryEntries(artifactsRoot, 128),
    },
) {
    try {
        return await recoverManagedBackupState(await io.read())
    } catch (error) {
        if (!missing(error)) throw error
        if ((await io.entries()).length !== 0)
            throw new Error('backup journal is missing for a nonempty artifact store', {
                cause: error,
            })
        return null
    }
}

export async function removeRetainedBackup(
    job: ManagedBackupJob,
    io = {
        exists: async (directory: string) => {
            try {
                await lstat(directory)
                return true
            } catch (error) {
                if (missing(error)) return false
                throw error
            }
        },
        inspect: (directory: string) => inspectOwnedArtifactDirectory(directory, false),
        remove: (directory: string) => rm(directory, { recursive: true }),
        sync: (directory: string) => syncBackupDirectory(directory),
    },
    root = artifactsRoot,
) {
    z.uuid().parse(job.id)
    if (job.state !== 'succeeded' || !job.retained || job.artifact?.id !== job.id)
        throw new Error('backup cannot be removed')
    // A prior removal may have reached disk before its retained=false state write. Only
    // absence of this exact canonical directory is idempotent; partial damage still fails.
    if (!(await io.exists(join(root, job.id)))) return
    const directory = await io.inspect(join(root, job.id))
    const receipt = await stageBackupDisposal(directory, root, randomUUID())
    await io.remove(receipt)
    await io.sync(root)
}
export function createBackupAgentHandler(
    engine: Engine,
    offHost?: Awaited<ReturnType<typeof createOffHostBackupService>>,
) {
    const status = async () => ({
        ...(await engine.status()),
        ...(offHost ? { offHost: offHost.status() } : {}),
    })
    const download = createBackupDownload(
        () => engine.status(),
        undefined,
        undefined,
        undefined,
        () => engine.acquireDownload(),
    )
    return async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname
        const downloadPath = /^\/artifacts\/([^/]+)\/download$/u.exec(path)
        const operationPath = /^\/artifacts\/([^/]+)\/(delete|restore)$/u.exec(path)
        if (request.method === 'GET' && downloadPath && new URL(request.url).search === '') {
            return download(request, downloadPath[1]!)
        }
        if (request.method === 'GET' && path === '/status') {
            try {
                return Response.json(await status())
            } catch {
                return Response.json({ error: 'unavailable' }, { status: 503 })
            }
        }
        if (
            request.method === 'GET' &&
            path === '/maintenance' &&
            new URL(request.url).search === ''
        ) {
            try {
                return Response.json({ maintenance: (await engine.status()).maintenance ?? null })
            } catch {
                return Response.json({ error: 'unavailable' }, { status: 503 })
            }
        }
        if (
            operationPath &&
            (!canonicalUuid(operationPath[1]!) || new URL(request.url).search !== '')
        )
            return Response.json({ error: 'invalid_input' }, { status: 400 })
        const schema =
            request.method === 'POST' && operationPath
                ? operationPath[2] === 'delete'
                    ? managedBackupDeleteSchema
                    : managedBackupRestoreSchema
                : request.method === 'POST' && path === '/start'
                  ? managedBackupStartSchema
                  : request.method === 'PUT' && path === '/off-host' && offHost
                    ? offHostConfigurationUpdateSchema
                    : request.method === 'PUT' && path === '/config'
                      ? managedBackupConfigurationUpdateSchema
                      : request.method === 'POST' && path === '/audit/ack'
                        ? managedBackupAuditAcknowledgementSchema
                        : null
        if (schema === null) return Response.json({ error: 'not_found' }, { status: 404 })
        let input: unknown
        try {
            const reader = request.body?.getReader()
            if (!reader) throw new Error('invalid input')
            const chunks: Uint8Array[] = []
            let size = 0
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
                await Promise.race([
                    (async () => {
                        while (true) {
                            const result = await reader.read()
                            if (result.done) break
                            size += result.value.byteLength
                            if (size > (path === '/off-host' ? 8192 : 2048))
                                throw new Error('invalid input')
                            chunks.push(result.value)
                        }
                    })(),
                    new Promise<never>((_, reject) => {
                        timeout = setTimeout(() => {
                            reject(new Error('invalid input'))
                        }, 5000)
                    }),
                ])
            } finally {
                clearTimeout(timeout)
                void reader.cancel().catch(() => {})
            }
            input = schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
            return Response.json({ error: 'invalid_input' }, { status: 400 })
        }
        try {
            if (operationPath)
                await engine.requestMaintenance(
                    operationPath[1]!,
                    input,
                    operationPath[2] as 'delete' | 'restore',
                )
            else if (path === '/start') await engine.start(input)
            else if (path === '/audit/ack') await engine.acknowledgeAudit(input)
            else if (path === '/off-host' && offHost) {
                const configuration = offHostConfigurationUpdateSchema.parse(input)
                await engine.configureOffHost(async () => {
                    await offHost.configure(configuration)
                })
            } else await engine.updateConfiguration(input)
            return Response.json(await status())
        } catch (error) {
            if (
                error instanceof ManagedBackupError &&
                ['busy', 'revision_conflict', 'capacity', 'artifact_invalid'].includes(error.code)
            )
                return Response.json(
                    { error: error.code === 'busy' ? 'busy' : 'conflict' },
                    { status: 409 },
                )
            return Response.json({ error: 'unavailable' }, { status: 503 })
        }
    }
}

export function createBackupAgentServer(
    socket: string,
    handler: ReturnType<typeof createBackupAgentHandler>,
) {
    const options = {
        unix: socket,
        maxRequestBodySize: 8192,
        fetch: handler,
    }
    // Bun 1.4.4 honors this Unix listener option although its types forbid it.
    // The timeout override on an individual request is ineffective for Unix sockets.
    Object.assign(options, { idleTimeout: 0 })
    return Bun.serve(options)
}

export async function reconcileBackupControl(
    jobs: ManagedBackupJob[],
    phase: 'startup' | 'runtime',
    io: {
        read: (path: string) => Promise<unknown | null>
        remove: (path: string) => Promise<void>
    },
    maintenance?:
        | import('../../../web/src/lib/Backups/Types/backups.types.ts').ManagedBackupMaintenance
        | null,
) {
    for (const path of [activeFile, requestFile]) {
        const value = await io.read(path)
        if (value === null) continue
        const identity = identitySchema.parse(value)
        const job = jobs.find((entry) => entry.id === identity.id)
        if (identity.kind === 'restore') {
            if (
                !maintenance ||
                maintenance.id !== identity.id ||
                maintenance.state === 'queued' ||
                maintenance.state === 'running'
            )
                throw new Error('restore lifecycle incomplete')
            if (path === activeFile) {
                const result = await io.read(resultFile)
                if (result !== null) {
                    if (resultSchema.parse(result).id !== identity.id)
                        throw new Error('restore lifecycle mismatch')
                    await io.remove(resultFile)
                }
            }
            await io.remove(path)
            continue
        }
        if (!job || job.state === 'queued' || job.state === 'running')
            throw new Error('backup lifecycle incomplete')
        if (path === activeFile) {
            const result = await io.read(resultFile)
            // The unique agent reconciles stopped work before consumers start. A missing
            // result cannot prove success, but must not make a stopped container unbootable.
            if (result === null) {
                if (phase !== 'startup' || (job.state !== 'interrupted' && job.state !== 'failed'))
                    throw new Error('backup lifecycle incomplete')
            } else {
                if (resultSchema.parse(result).id !== identity.id)
                    throw new Error('backup lifecycle mismatch')
                await io.remove(resultFile)
            }
        }
        await io.remove(path)
    }
}
export async function reconcileCompletedBackups(
    jobs: ManagedBackupJob[],
    phase: 'startup' | 'runtime',
    io: Parameters<typeof reconcileBackupControl>[2],
    root = artifactsRoot,
) {
    await reconcileBackupControl(jobs, phase, io)
    await reconcileBackupArtifacts(jobs, root)
}

export async function startBackupAgent() {
    if (process.getuid?.() !== 0) throw new Error('backup agent requires root')
    await privateDirectory(backupRoot)
    await privateDirectory(artifactsRoot)
    await cleanupOffHostTemporaryFiles()
    const control = await lstat(controlRoot)
    if (
        !control.isDirectory() ||
        control.isSymbolicLink() ||
        control.uid !== 0 ||
        control.gid !== 10001 ||
        (control.mode & 0o777) !== 0o750
    )
        throw new Error('invalid backup control directory')
    const source = managedBackupSourceSchema.parse(await readPrivateJson(sourceFile, 4096))
    const stop = new AbortController()
    let fatal = false
    const offHost = await createOffHostBackupService()
    const engine = await createManagedBackupEngine({
        read: () => loadManagedBackupState(),
        write: async (state) => {
            await writePrivateJson(stateFile, state)
            try {
                await writeMaintenanceProgress(state.maintenance ?? null)
            } catch (error) {
                fatal = true
                throw error
            }
        },
        now: Date.now,
        id: randomUUID,
        source: () => structuredClone(source),
        replicate: (job) => offHost.upload(job, engine.retentionCount, stop.signal),
        offHostAudit: {
            pending: offHost.pendingConfigurationAudit,
            acknowledge: offHost.acknowledgeConfigurationAudit,
        },
        execute: async (job) => {
            if (JSON.stringify(job.source) !== JSON.stringify(source))
                throw new ManagedBackupError('execution_failed')
            // The engine serializes execution and has durably marked this job
            // running. Protect it while clearing earlier failed publications.
            await reconcileBackupArtifacts((await engine.status()).jobs)
            try {
                await lstat(activeFile)
                throw new ManagedBackupError('recovery_failed')
            } catch (error) {
                if (!missing(error)) {
                    fatal = true
                    throw error
                }
            }
            await rm(resultFile, { force: true })
            await writePrivateJson(requestFile, { id: job.id })
            const deadline = performance.now() + 900_000
            while (!stop.signal.aborted && performance.now() < deadline) {
                try {
                    const result = resultSchema.parse(await readPrivateJson(resultFile, 4096))
                    if (result.id === job.id) {
                        if (!result.success)
                            throw new ManagedBackupError(result.error ?? 'execution_failed')
                        try {
                            return await artifactFor(job)
                        } catch {
                            throw new ManagedBackupError('artifact_invalid')
                        }
                    }
                } catch (error) {
                    if (error instanceof ManagedBackupError) throw error
                    if (!missing(error)) throw new ManagedBackupError('execution_failed')
                }
                await Bun.sleep(250)
            }
            fatal = true
            throw new ManagedBackupError('recovery_failed')
        },
        verify: async (job) => {
            if (job.artifact === null || job.artifact.id !== job.id) return false
            try {
                return JSON.stringify(await artifactFor(job)) === JSON.stringify(job.artifact)
            } catch {
                return false
            }
        },
        remove: (job) => removeRetainedBackup(job),
        removed: async (job) => {
            try {
                await lstat(join(artifactsRoot, job.id))
                return false
            } catch (error) {
                if (missing(error)) return true
                throw error
            }
        },
        recoverRestore: async (operation) => {
            try {
                const active = identitySchema.parse(await readPrivateJson(activeFile, 4096))
                const result = resultSchema.parse(await readPrivateJson(resultFile, 4096))
                return (
                    active.kind === 'restore' &&
                    active.id === operation.id &&
                    result.id === operation.id &&
                    result.success &&
                    result.error === undefined
                )
            } catch (error) {
                if (missing(error)) return false
                throw error
            }
        },
        restore: async (_job, operation, progress) => {
            await offHost.pause()
            await writeMaintenanceProgress(operation)
            try {
                await lstat(activeFile)
                throw new ManagedBackupError('recovery_failed')
            } catch (error) {
                if (!missing(error)) throw error
            }
            await rm(resultFile, { force: true })
            const phasePath = join(controlRoot, 'restore-progress.json')
            await rm(phasePath, { force: true })
            await writePrivateJson(requestFile, { id: operation.id, kind: 'restore' })
            const deadline = performance.now() + 1_200_000
            let last = -1
            while (!stop.signal.aborted && performance.now() < deadline) {
                try {
                    const update = z
                        .strictObject({
                            id: z.uuid(),
                            phase: z.enum([
                                'validating',
                                'quiescing',
                                'database',
                                'controller',
                                'crowdsec',
                                'secrets',
                                'restarting',
                            ]),
                            progressPercent: z.number().int().min(0).max(99),
                        })
                        .parse(await readPrivateJson(phasePath, 4096))
                    if (update.id !== operation.id) throw new ManagedBackupError('recovery_failed')
                    if (update.progressPercent > last) {
                        await progress(update.phase, update.progressPercent)
                        last = update.progressPercent
                    }
                } catch (error) {
                    if (!missing(error)) throw error
                }
                try {
                    const result = resultSchema.parse(await readPrivateJson(resultFile, 4096))
                    if (result.id !== operation.id) throw new ManagedBackupError('recovery_failed')
                    if (!result.success)
                        throw new ManagedBackupError(result.error ?? 'execution_failed')
                    return
                } catch (error) {
                    if (!missing(error)) throw error
                }
                await Bun.sleep(100)
            }
            fatal = true
            throw new ManagedBackupError('recovery_failed')
        },
    })
    async function reconcileCompletedWork(phase: 'startup' | 'runtime') {
        const status = await engine.status()
        const io = {
            read: async (path: string) => {
                try {
                    return await readPrivateJson(path, 4096)
                } catch (error) {
                    if (missing(error)) return null
                    throw error
                }
            },
            remove: (path: string) => rm(path),
        }
        await reconcileBackupControl(status.jobs, phase, io, status.maintenance)
        await reconcileBackupArtifacts(status.jobs)
    }
    await writeMaintenanceProgress((await engine.status()).maintenance ?? null)
    await reconcileCompletedWork('startup')
    const socket = join(controlRoot, 'agent.sock')
    const server = createBackupAgentServer(socket, createBackupAgentHandler(engine, offHost))
    try {
        await chmod(socket, 0o660)
        await chown(socket, 0, 10001)
    } catch (error) {
        await server.stop(true)
        throw error
    }
    let ticking = false
    const timer = setInterval(() => {
        if (ticking) return
        ticking = true
        void engine
            .tick()
            .then(async () => {
                if (fatal) {
                    shutdown()
                    process.exitCode = 1
                    return
                }
                await reconcileCompletedWork('runtime')
            })
            .catch(() => {
                console.error('[backups] Job processing unavailable')
                shutdown()
                process.exitCode = 1
            })
            .finally(() => {
                ticking = false
            })
    }, 1000)
    const shutdown = () => {
        clearInterval(timer)
        stop.abort()
        void server.stop(true)
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    return { engine, shutdown }
}

if (import.meta.main) {
    try {
        await startBackupAgent()
    } catch {
        console.error('[backups] Agent initialization failed')
        process.exitCode = 1
    }
}
