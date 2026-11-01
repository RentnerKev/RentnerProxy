// oxlint-disable no-await-in-loop -- Validate every ancestor before using private recovery paths.
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { readFileRange } from './backup/artifact-file.ts'
import { decryptBackup, recoveryKeyId } from './backup/offhost/envelope.ts'
import { createS3Storage } from './backup/offhost/s3.ts'

const failure =
    'Off-host backup recovery failed. Check the private target and recovery-key files, object and destination, then retry. No production restore was started.'
const usage =
    'bun --no-env-file scripts/recover-offhost-backup.ts --target-file <target.json> --key-file <recovery-key.json> --object <targetId/jobId.rpbk> --output <backup-dir> [--timeout-seconds <1-7200>]'
const targetSchema = z.strictObject({
    endpoint: z.string().min(1).max(2048),
    region: z.string().min(1).max(64),
    bucket: z.string().min(1).max(63),
    prefix: z.string().min(1).max(768),
    accessKeyId: z.string().min(1).max(128),
    secretAccessKey: z.string().min(1).max(256),
})
const recoverySchema = z.strictObject({
    format: z.literal('rentnerproxy-off-host-recovery-key'),
    version: z.literal(1),
    recoveryKey: z.string().length(44),
    keyId: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
})

function parseArguments(args: readonly string[]) {
    const values = new Map<string, string>()
    const required = ['--target-file', '--key-file', '--object', '--output']
    const allowed = new Set([...required, '--timeout-seconds'])
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index]!
        const value = args[index + 1]
        if (
            !allowed.has(flag) ||
            values.has(flag) ||
            !value ||
            value.startsWith('--') ||
            value.length > 4096 ||
            [...value].some(
                (character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
            )
        )
            throw new Error(failure)
        values.set(flag, value)
    }
    if (required.some((flag) => !values.has(flag))) throw new Error(failure)
    const object = values.get('--object')!
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.rpbk$/u.test(object))
        throw new Error(failure)
    const timeout = values.get('--timeout-seconds') ?? '7200'
    if (!/^[1-9][0-9]{0,3}$/u.test(timeout) || Number(timeout) > 7200) throw new Error(failure)
    return {
        targetFile: resolve(values.get('--target-file')!),
        keyFile: resolve(values.get('--key-file')!),
        object,
        output: resolve(values.get('--output')!),
        timeoutMs: Number(timeout) * 1000,
    }
}

async function safeDirectory(directory: string): Promise<void> {
    let path = directory
    while (true) {
        const info = await lstat(path)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(failure)
        const parent = dirname(path)
        if (parent === path) return
        path = parent
    }
}

async function absent(path: string): Promise<void> {
    try {
        await lstat(path)
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
        throw error
    }
    throw new Error(failure)
}

async function privateJson(path: string, maximum: number, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    await safeDirectory(dirname(path))
    const expected = await lstat(path)
    if (
        !expected.isFile() ||
        expected.isSymbolicLink() ||
        expected.nlink !== 1 ||
        expected.size < 1 ||
        expected.size > maximum ||
        (process.platform !== 'win32' && (expected.mode & 0o077) !== 0)
    )
        throw new Error(failure)
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let bytes: Buffer | undefined
    try {
        const info = await file.stat()
        if (
            !info.isFile() ||
            info.nlink !== 1 ||
            info.dev !== expected.dev ||
            info.ino !== expected.ino ||
            info.size !== expected.size ||
            (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
        )
            throw new Error(failure)
        signal.throwIfAborted()
        bytes = await readFileRange(file, 0, info.size)
        const extra = Buffer.alloc(1)
        if (
            (await file.read(extra, 0, 1, info.size)).bytesRead ||
            (await file.stat()).size !== info.size
        )
            throw new Error(failure)
        signal.throwIfAborted()
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } finally {
        bytes?.fill(0)
        await file.close()
    }
}

export async function recoverOffHostBackup(
    args: readonly string[],
    dependencies: {
        signal?: AbortSignal
        download?: (object: string, outputFile: string, signal: AbortSignal) => Promise<void>
    } = {},
): Promise<{ outputDirectory: string }> {
    try {
        const options = parseArguments(args)
        const signal = AbortSignal.any([
            AbortSignal.timeout(options.timeoutMs),
            ...(dependencies.signal ? [dependencies.signal] : []),
        ])
        signal.throwIfAborted()
        await safeDirectory(dirname(options.output))
        await absent(options.output)
        const target = targetSchema.parse(await privateJson(options.targetFile, 8192, signal))
        const recovery = recoverySchema.parse(await privateJson(options.keyFile, 4096, signal))
        const keyId = recoveryKeyId(recovery.recoveryKey)
        if (recovery.keyId !== undefined && recovery.keyId !== keyId) throw new Error(failure)
        // Construction validates credentials and endpoint syntax without performing network I/O.
        const storage = createS3Storage(target)
        let staging: string | undefined
        try {
            signal.throwIfAborted()
            staging = await mkdtemp(join(dirname(options.output), '.rentnerproxy-recovery-'))
            await chmod(staging, 0o700)
            const encrypted = join(staging, 'backup.rpbk')
            await (dependencies.download ?? storage.get)(options.object, encrypted, signal)
            signal.throwIfAborted()
            await decryptBackup(encrypted, options.output, recovery.recoveryKey, signal)
            return { outputDirectory: options.output }
        } finally {
            if (staging) await rm(staging, { recursive: true, force: true })
        }
    } catch {
        // Providers, parsers, filesystem errors and abort reasons can contain secrets or paths.
        throw new Error(failure)
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--help') {
        console.log(usage)
    } else {
        const controller = new AbortController()
        const stop = () => controller.abort()
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        try {
            await recoverOffHostBackup(args, { signal: controller.signal })
            console.log(
                'Off-host backup downloaded, authenticated and verified. No production restore was started.',
            )
            console.log(
                'Review the recovered backup, then replace <backup-dir> in this separate restore command:',
            )
            console.log(
                'bun --no-env-file scripts/production-restore.ts --input <backup-dir> --confirm-replace',
            )
        } catch {
            console.error(failure)
            process.exitCode = 1
        } finally {
            process.off('SIGINT', stop)
            process.off('SIGTERM', stop)
        }
    }
}
