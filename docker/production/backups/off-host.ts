// oxlint-disable no-await-in-loop -- Verify and prune known remote objects sequentially.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
    parseApplicationEncryptionKeyFile,
    readFileRange,
} from '../../../scripts/backup/artifact-file.ts'
import { encryptBackup, recoveryKeyId } from '../../../scripts/backup/offhost/envelope.ts'
import { createS3Storage, validateS3Target } from '../../../scripts/backup/offhost/s3.ts'
import {
    offHostConfigurationAuditSchema,
    offHostConfigurationUpdateSchema,
    offHostReceiptSchema,
    offHostStatusSchema,
} from '../../../web/src/lib/Backups/offHostValidation.ts'
import type { ManagedBackupJob } from '../../../web/src/lib/Backups/Types/backups.types.ts'
import type {
    OffHostConfigurationAudit,
    OffHostReceipt,
} from '../../../web/src/lib/Backups/Types/off-host.types.ts'
import { artifactsRoot, backupRoot, readPrivateJson, writePrivateJson } from './storage.ts'
import { ManagedBackupError } from '../../../scripts/backup/managed-jobs.ts'

const secretSchema = z.strictObject({
    accessKeyId: z.string().min(1).max(256),
    secretAccessKey: z.string().min(1).max(512),
    recoveryKey: z.string(),
})
const stateSchema = z
    .strictObject({
        version: z.literal(1),
        configuration: offHostStatusSchema.omit({ retainedCopies: true }),
        sealed: z
            .strictObject({ iv: z.string().max(32), ciphertext: z.string().max(4096) })
            .nullable(),
        receipts: z.array(offHostReceiptSchema).max(100),
        requests: z
            .array(
                z.strictObject({
                    id: z.uuid(),
                    actorId: z.uuid().optional(),
                    fingerprint: z.string().length(64),
                }),
            )
            .max(100),
        pendingAudit: offHostConfigurationAuditSchema.optional(),
    })
    .superRefine((state, context) => {
        const pending = state.pendingAudit
        if (
            pending &&
            !state.requests.some(
                (request) =>
                    request.id === pending.requestId &&
                    request.actorId === pending.actorId &&
                    request.fingerprint === pending.fingerprint,
            )
        )
            context.addIssue({ code: 'custom', message: 'invalid off-host audit ownership' })
    })
type State = z.infer<typeof stateSchema>
const aad = (targetId: string) => Buffer.from('rentnerproxy-off-host-configuration-v1:' + targetId)
const statePath = join(backupRoot, 'off-host.json')

/** Startup only, before the service can create or use temporary files. */
export async function cleanupOffHostTemporaryFiles(
    root = backupRoot,
    io = {
        inspect: (path: string) => lstat(path),
        directory: (path: string) => opendir(path),
        remove: (path: string) => unlink(path),
    },
): Promise<void> {
    const parent = await io.inspect(root)
    if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== 0 ||
        (parent.mode & 0o077) !== 0
    )
        throw new Error('off-host temporary directory unsafe')
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    const ownedName = new RegExp(`^\\.off-host-${uuid}(?:\\.verify)?(?:\\.${uuid}\\.partial)?$`)
    const directory = await io.directory(root)
    let scanned = 0
    for await (const entry of directory) {
        if (++scanned > 10_000) throw new Error('off-host temporary scan capacity')
        if (!ownedName.test(entry.name)) continue
        const path = join(root, entry.name)
        let info
        try {
            info = await io.inspect(path)
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
            throw error
        }
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077) !== 0)
            continue
        // Unlink only this owned name; other links remain intact, including a
        // completed download whose temporary publication link survived a crash.
        await io.remove(path)
    }
}

async function wrappingKey() {
    const file = await open(
        '/run/rentnerproxy/app-key/value',
        constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
        const info = await file.stat()
        if (
            !info.isFile() ||
            info.nlink !== 1 ||
            info.size > 128 ||
            info.uid !== 10002 ||
            (info.mode & 0o077) !== 0
        )
            throw new Error('off-host secret storage unavailable')
        return await parseApplicationEncryptionKeyFile(file)
    } finally {
        await file.close()
    }
}

export async function hashOffHostFile(path: string, signal?: AbortSignal) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 32 * 1024 ** 3)
            throw new Error('invalid encrypted backup')
        const hash = createHash('sha256')
        for (let offset = 0; offset < info.size; offset += 65_536) {
            signal?.throwIfAborted()
            hash.update(await readFileRange(file, offset, Math.min(65_536, info.size - offset)))
        }
        const after = await file.stat()
        if (
            after.size !== info.size ||
            after.mtimeMs !== info.mtimeMs ||
            after.ctimeMs !== info.ctimeMs
        )
            throw new Error('encrypted backup changed')
        return { bytes: info.size, sha256: hash.digest('hex') }
    } finally {
        await file.close()
    }
}

export async function createOffHostBackupService(
    dependencies = {
        read: async (): Promise<unknown | null> => {
            try {
                return await readPrivateJson(statePath)
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                    return null
                throw error
            }
        },
        write: (state: State) => writePrivateJson(statePath, state),
        wrappingKey,
        storage: createS3Storage,
        validateTarget: validateS3Target,
        encrypt: encryptBackup,
        hash: hashOffHostFile,
        removeFile: (path: string) => rm(path, { force: true }),
        artifacts: artifactsRoot,
        temporary: backupRoot,
        now: Date.now,
        id: (): string => randomUUID(),
    },
) {
    const loaded = await dependencies.read()
    let state: State =
        loaded === null
            ? {
                  version: 1,
                  configuration: {
                      revision: 0,
                      enabled: false,
                      endpoint: '',
                      region: '',
                      bucket: '',
                      prefix: '',
                      configured: false,
                      targetId: null,
                      keyId: null,
                  },
                  sealed: null,
                  receipts: [],
                  requests: [],
              }
            : stateSchema.parse(loaded)

    let uncertain = false
    async function reload() {
        const durable = await dependencies.read()
        if (durable !== null) state = stateSchema.parse(durable)
        else if (state.configuration.revision !== 0 || state.requests.length !== 0)
            throw new Error('off-host state unavailable')
        uncertain = false
    }
    async function commit(draft: State) {
        stateSchema.parse(draft)
        try {
            await dependencies.write(draft)
            state = structuredClone(draft)
        } catch (error) {
            // A failed fsync can follow a successful rename. Recover the authority,
            // including its atomic audit outbox, before another operation can write.
            uncertain = true
            await reload().catch(() => {})
            throw error
        }
    }
    function status() {
        return offHostStatusSchema.parse({
            ...state.configuration,
            retainedCopies: state.receipts.filter(
                (entry) => entry.targetId === state.configuration.targetId,
            ).length,
        })
    }
    async function unseal() {
        if (!state.sealed || !state.configuration.targetId)
            throw new Error('off-host configuration unavailable')
        const decipher = createDecipheriv(
            'aes-256-gcm',
            await dependencies.wrappingKey(),
            Buffer.from(state.sealed.iv, 'base64'),
        )
        decipher.setAAD(aad(state.configuration.targetId))
        const payload = Buffer.from(state.sealed.ciphertext, 'base64')
        decipher.setAuthTag(payload.subarray(-16))
        return secretSchema.parse(
            JSON.parse(
                Buffer.concat([
                    decipher.update(payload.subarray(0, -16)),
                    decipher.final(),
                ]).toString('utf8'),
            ),
        )
    }
    async function configure(input: unknown) {
        const request = offHostConfigurationUpdateSchema.parse(input)
        await reload()
        const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
        const previous = state.requests.find((entry) => entry.id === request.requestId)
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw new ManagedBackupError('revision_conflict')
            return status()
        }
        if (request.expectedRevision !== state.configuration.revision)
            throw new ManagedBackupError('revision_conflict')
        if (state.pendingAudit) throw new ManagedBackupError('busy')
        if (request.recoveryKey && !request.recoveryKeySaved)
            throw new Error('recovery key must be saved')
        if (
            !request.enabled &&
            !request.recoveryKey &&
            !request.accessKeyId &&
            !request.secretAccessKey
        ) {
            const disabled = structuredClone(state)
            disabled.configuration.enabled = false
            disabled.configuration.revision += 1
            disabled.pendingAudit = {
                requestId: request.requestId,
                actorId: request.actorId,
                fingerprint,
            }
            disabled.requests.push({ id: request.requestId, actorId: request.actorId, fingerprint })
            disabled.requests = disabled.requests.slice(-100)
            await commit(disabled)
            return status()
        }
        const replacesSecrets =
            request.accessKeyId && request.secretAccessKey && request.recoveryKey
        const old = state.sealed && !replacesSecrets ? await unseal() : null
        const secret = {
            accessKeyId: request.accessKeyId || old?.accessKeyId || '',
            secretAccessKey: request.secretAccessKey || old?.secretAccessKey || '',
            recoveryKey: request.recoveryKey || old?.recoveryKey || '',
        }
        const configured = secretSchema.safeParse(secret).success && secret.recoveryKey !== ''
        if (request.enabled && !configured) throw new Error('off-host configuration incomplete')
        const draft = structuredClone(state)
        let targetId = state.configuration.targetId
        let keyId = state.configuration.keyId
        if (configured) {
            keyId = recoveryKeyId(secret.recoveryKey)
            const target = await dependencies.validateTarget({
                endpoint: request.endpoint,
                region: request.region,
                bucket: request.bucket,
                prefix: request.prefix,
                accessKeyId: secret.accessKeyId,
                secretAccessKey: secret.secretAccessKey,
            })
            const changed =
                keyId !== state.configuration.keyId ||
                (['endpoint', 'region', 'bucket', 'prefix'] as const).some(
                    (key) => target[key] !== state.configuration[key],
                )
            if (changed || !targetId) targetId = dependencies.id()
            const key = await dependencies.wrappingKey()
            if (secret.recoveryKey === key.toString('base64'))
                throw new Error('independent recovery key required')
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, iv)
            cipher.setAAD(aad(targetId))
            draft.sealed = {
                iv: iv.toString('base64'),
                ciphertext: Buffer.concat([
                    cipher.update(JSON.stringify(secret)),
                    cipher.final(),
                    cipher.getAuthTag(),
                ]).toString('base64'),
            }
            draft.configuration = {
                ...draft.configuration,
                endpoint: target.endpoint,
                region: target.region,
                bucket: target.bucket,
                prefix: target.prefix,
            }
        }
        draft.configuration = {
            ...draft.configuration,
            revision: state.configuration.revision + 1,
            enabled: request.enabled,
            configured,
            targetId,
            keyId,
        }
        draft.pendingAudit = { requestId: request.requestId, actorId: request.actorId, fingerprint }
        draft.requests.push({ id: request.requestId, actorId: request.actorId, fingerprint })
        draft.requests = draft.requests.slice(-100)
        await commit(draft)
        return status()
    }
    async function upload(
        job: ManagedBackupJob,
        retention: number | (() => number),
        signal?: AbortSignal,
    ): Promise<OffHostReceipt | null> {
        if (uncertain) await reload()
        if (!state.configuration.enabled) return null
        if (!job.artifact || !state.configuration.targetId || !state.configuration.keyId)
            throw new Error('off-host backup unavailable')
        const config = state.configuration
        const secret = await unseal()
        const storage = dependencies.storage({ ...config, ...secret })
        const temporary = join(dependencies.temporary, '.off-host-' + dependencies.id())
        const verification = temporary + '.verify'
        const objectKey = config.targetId + '/' + job.id + '.rpbk'
        async function prune(verified: OffHostReceipt) {
            while (true) {
                const keep = typeof retention === 'number' ? retention : retention()
                if (!Number.isInteger(keep) || keep < 1 || keep > 100)
                    throw new Error('off-host retention invalid')
                const owned = state.receipts.filter((entry) => entry.targetId === config.targetId)
                if (owned.length <= keep) return
                const candidate = owned.find(
                    (entry) =>
                        entry.objectKey !== verified.objectKey &&
                        entry.objectKey.startsWith(config.targetId + '/'),
                )
                if (!candidate) return
                signal?.throwIfAborted()
                await storage.remove(candidate.objectKey, signal)
                const draft = structuredClone(state)
                draft.receipts = draft.receipts.filter(
                    (entry) =>
                        entry.targetId !== candidate.targetId ||
                        entry.objectKey !== candidate.objectKey,
                )
                await commit(draft)
            }
        }
        try {
            if (state.receipts.length >= 100) {
                // Old targets cannot be deleted with the current target's credentials.
                // Reclaim ledger space only; their remote objects and job receipts survive.
                const draft = structuredClone(state)
                while (draft.receipts.length >= 100) {
                    const obsolete = draft.receipts.findIndex(
                        (entry) => entry.targetId !== config.targetId,
                    )
                    if (obsolete === -1) break
                    draft.receipts.splice(obsolete, 1)
                }
                if (draft.receipts.length < state.receipts.length) await commit(draft)
                if (state.receipts.length >= 100) {
                    const newest = state.receipts.findLast(
                        (entry) => entry.targetId === config.targetId,
                    )
                    try {
                        if (!newest || !newest.objectKey.startsWith(config.targetId + '/'))
                            throw new Error('invalid ownership')
                        await storage.get(newest.objectKey, verification, signal)
                        const checked = await dependencies.hash(verification, signal)
                        if (checked.bytes !== newest.bytes || checked.sha256 !== newest.sha256)
                            throw new Error('invalid readback')
                        await prune(newest)
                    } catch {
                        throw new Error('off-host history capacity')
                    } finally {
                        await dependencies.removeFile(verification)
                    }
                    if (state.receipts.length >= 100) throw new Error('off-host history capacity')
                }
            }
            const envelope = await dependencies.encrypt(
                join(dependencies.artifacts, job.id),
                temporary,
                secret.recoveryKey,
                signal,
            )
            await storage.put(objectKey, temporary, signal)
            await storage.get(objectKey, verification, signal)
            const checked = await dependencies.hash(verification, signal)
            if (checked.bytes !== envelope.bytes || checked.sha256 !== envelope.sha256)
                throw new Error('remote backup verification failed')
            const receipt = offHostReceiptSchema.parse({
                state: 'succeeded',
                targetId: config.targetId,
                keyId: config.keyId,
                objectKey,
                ...checked,
                verifiedAt: dependencies.now(),
            })
            const draft = structuredClone(state)
            draft.receipts.push(receipt)
            await commit(draft)
            // Keep every known copy until the replacement has been read back in full.
            // Only this target namespace and exact owned receipts can authorize deletion.
            await prune(receipt).catch(() => {})
            return receipt
        } finally {
            await Promise.all([
                dependencies.removeFile(temporary),
                dependencies.removeFile(verification),
            ])
        }
    }
    async function pause() {
        if (uncertain) await reload()
        if (!state.configuration.enabled) return
        const draft = structuredClone(state)
        draft.configuration.enabled = false
        draft.configuration.revision += 1
        await commit(draft)
    }
    let chain = Promise.resolve()
    function serialize<T>(run: () => Promise<T>): Promise<T> {
        const result = chain.then(run)
        chain = result.then(
            () => {},
            () => {},
        )
        return result
    }
    return {
        status,
        pendingConfigurationAudit: () =>
            serialize(async () => {
                await reload()
                return state.pendingAudit ? structuredClone(state.pendingAudit) : null
            }),
        acknowledgeConfigurationAudit: (input: OffHostConfigurationAudit) =>
            serialize(async () => {
                const receipt = offHostConfigurationAuditSchema.parse(input)
                await reload()
                if (!state.pendingAudit) return
                if (JSON.stringify(state.pendingAudit) !== JSON.stringify(receipt))
                    throw new ManagedBackupError('revision_conflict')
                const draft = structuredClone(state)
                delete draft.pendingAudit
                await commit(draft)
            }),
        configure: (input: unknown) => serialize(() => configure(input)),
        upload: (job: ManagedBackupJob, retention: number | (() => number), signal?: AbortSignal) =>
            serialize(() => upload(job, retention, signal)),
        pause: () => serialize(pause),
    }
}
