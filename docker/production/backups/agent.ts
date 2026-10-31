// oxlint-disable no-await-in-loop -- Poll one supervisor result and inspect fixed owned files sequentially.
import { randomUUID } from 'node:crypto'
import { chmod, chown, lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
    createManagedBackupEngine,
    ManagedBackupError,
} from '../../../scripts/backup/managed-jobs.ts'
import { syncBackupDirectory, verifyPublishedBackup } from '../../../scripts/backup/publication.ts'
import {
    managedBackupArtifactSchema,
    managedBackupStateSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
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
const identitySchema = z.strictObject({ id: z.uuid() })

function missing(error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function ownedArtifactDirectory(id: string, staging = false) {
    z.uuid().parse(id)
    const directory = join(artifactsRoot, (staging ? '.staging-' : '') + id)
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new Error('invalid backup directory')
    const entries = await readdir(directory)
    if (
        (!staging && entries.length !== artifactNames.length) ||
        entries.some((name) => !artifactNames.includes(name))
    )
        throw new Error('invalid backup entries')
    for (const name of entries) {
        const file = await lstat(join(directory, name))
        if (
            !file.isFile() ||
            file.isSymbolicLink() ||
            file.nlink !== 1 ||
            file.uid !== 0 ||
            (file.mode & 0o077) !== 0
        )
            throw new Error('invalid backup file')
    }
    return directory
}

async function artifactFor(job: ManagedBackupJob) {
    const directory = await ownedArtifactDirectory(job.id)
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
        inspect: (id: string) => ownedArtifactDirectory(id),
        remove: (directory: string) => rm(directory, { recursive: true }),
        sync: () => syncBackupDirectory(artifactsRoot),
    },
) {
    z.uuid().parse(job.id)
    if (job.state !== 'succeeded' || !job.retained || job.artifact?.id !== job.id)
        throw new Error('backup cannot be removed')
    // A prior removal may have reached disk before its retained=false state write. Only
    // absence of this exact canonical directory is idempotent; partial damage still fails.
    if (!(await io.exists(join(artifactsRoot, job.id)))) return
    const directory = await io.inspect(job.id)
    await io.remove(directory)
    await io.sync()
}
export function createBackupAgentHandler(engine: Engine) {
    return async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path === '/status') {
            try {
                return Response.json(await engine.status())
            } catch {
                return Response.json({ error: 'unavailable' }, { status: 503 })
            }
        }
        const schema =
            request.method === 'POST' && path === '/start'
                ? managedBackupStartSchema
                : request.method === 'PUT' && path === '/config'
                  ? managedBackupConfigurationUpdateSchema
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
                            if (size > 2048) throw new Error('invalid input')
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
            if (path === '/start') await engine.start(input)
            else await engine.updateConfiguration(input)
            return Response.json(await engine.status())
        } catch (error) {
            if (
                error instanceof ManagedBackupError &&
                ['busy', 'revision_conflict', 'capacity'].includes(error.code)
            )
                return Response.json(
                    { error: error.code === 'busy' ? 'busy' : 'conflict' },
                    { status: 409 },
                )
            return Response.json({ error: 'unavailable' }, { status: 503 })
        }
    }
}

export async function reconcileBackupControl(
    jobs: ManagedBackupJob[],
    phase: 'startup' | 'runtime',
    io: {
        read: (path: string) => Promise<unknown | null>
        remove: (path: string) => Promise<void>
    },
) {
    for (const path of [activeFile, requestFile]) {
        const value = await io.read(path)
        if (value === null) continue
        const identity = identitySchema.parse(value)
        const job = jobs.find((entry) => entry.id === identity.id)
        if (!job || job.state === 'queued' || job.state === 'running')
            throw new Error('backup lifecycle incomplete')
        if (path === activeFile) {
            const result = await io.read(resultFile)
            // The unique agent reconciles old interrupted work before consumers start. A missing
            // result cannot prove success, but must not make a stopped container unbootable.
            if (result === null) {
                if (phase !== 'startup' || job.state !== 'interrupted')
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
export async function startBackupAgent() {
    if (process.getuid?.() !== 0) throw new Error('backup agent requires root')
    await privateDirectory(backupRoot)
    await privateDirectory(artifactsRoot)
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
    const engine = await createManagedBackupEngine({
        read: async () => {
            try {
                return await recoverManagedBackupState(await readPrivateJson(stateFile))
            } catch (error) {
                if (missing(error)) return null
                throw error
            }
        },
        write: (state) => writePrivateJson(stateFile, state),
        now: Date.now,
        id: randomUUID,
        source: () => structuredClone(source),
        execute: async (job) => {
            if (JSON.stringify(job.source) !== JSON.stringify(source))
                throw new ManagedBackupError('execution_failed')
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
    })
    async function clearCompletedControl(phase: 'startup' | 'runtime') {
        await reconcileBackupControl((await engine.status()).jobs, phase, {
            read: async (path) => {
                try {
                    return await readPrivateJson(path, 4096)
                } catch (error) {
                    if (missing(error)) return null
                    throw error
                }
            },
            remove: (path) => rm(path),
        })
    }
    await clearCompletedControl('startup')
    for (const job of (await engine.status()).jobs) {
        if (job.state !== 'failed' && job.state !== 'interrupted') continue
        try {
            await rm(await ownedArtifactDirectory(job.id, true), { recursive: true })
        } catch (error) {
            if (!missing(error)) throw error
        }
    }
    const socket = join(controlRoot, 'agent.sock')
    const server = Bun.serve({
        unix: socket,
        maxRequestBodySize: 2048,
        fetch: createBackupAgentHandler(engine),
    })
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
                await clearCompletedControl('runtime')
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
