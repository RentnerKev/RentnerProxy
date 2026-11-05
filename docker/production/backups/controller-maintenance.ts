// oxlint-disable no-await-in-loop -- Observe the one owned Caddy process until its bounded shutdown completes.
import { constants } from 'node:fs'
import { lstat, open, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import { controlRoot, readPrivateJson, writePrivateJson } from './storage.ts'

const requestPath = join(controlRoot, 'controller-maintenance-request.json')
const receiptPath = join(controlRoot, 'controller-maintenance-receipt.json')
const ownedPath = join(controlRoot, 'controller-maintenance-owned.json')
const pidSchema = z.number().int().min(2).max(2_147_483_647)
const ticksSchema = z.string().regex(/^[0-9]{1,20}$/u)
const requestSchema = z.strictObject({
    id: z.uuid(),
    controllerPid: pidSchema,
    controllerStartTicks: ticksSchema,
    expiresAt: z.number().int().positive().safe(),
})
const receiptSchema = z
    .strictObject({
        id: z.uuid(),
        controllerPid: pidSchema,
        caddyPid: pidSchema.nullable(),
        caddyStartTicks: ticksSchema.nullable(),
    })
    .refine((value) => (value.caddyPid === null) === (value.caddyStartTicks === null))

function missing(error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function requireRootControl() {
    const info = await lstat(controlRoot)
    if (
        process.getuid?.() !== 0 ||
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== 0 ||
        info.gid !== 10001 ||
        (info.mode & 0o7777) !== 0o750
    )
        throw new Error('Unsafe controller maintenance directory')
}

export function processStartTicks(value: string): string {
    const separator = value.lastIndexOf(') ')
    if (separator < 0) throw new Error('Invalid process identity')
    return ticksSchema.parse(
        value
            .slice(separator + 2)
            .trim()
            .split(/\s+/u)[19],
    )
}

async function processIdentity(pid: number, binary?: string): Promise<string | null> {
    pidSchema.parse(pid)
    try {
        const before = processStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'))
        const status = await readFile(`/proc/${pid}/status`, 'utf8')
        if (/^State:\s+[ZX](?:\s|$)/mu.test(status)) return null
        const uids = /^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/mu.exec(status)
        if (!uids || uids.slice(1).some((value) => value !== '10001'))
            throw new Error('Unexpected controller maintenance process')
        if (binary) {
            // Docker deliberately omits CAP_SYS_PTRACE. Read /proc/exe with the
            // process's own UID instead of broadening the container privileges.
            const result = await runMaintenanceProcess(
                [
                    'gosu',
                    'rentnerproxy',
                    'stat',
                    '--dereference',
                    '--format=%d:%i',
                    '--',
                    `/proc/${pid}/exe`,
                ],
                {
                    cwd: '/',
                    env: { PATH: '/usr/local/bin:/usr/bin:/bin', LC_ALL: 'C' },
                    timeoutMs: 2_000,
                    maximumOutputBytes: 128,
                },
            )
            if (!result.stopped || result.failed) {
                try {
                    await readFile(`/proc/${pid}/stat`, 'utf8')
                } catch (error) {
                    if (missing(error)) return null
                    throw error
                }
                throw new Error('Controller maintenance executable could not be verified')
            }
            const expected = await stat(binary, { bigint: true })
            if (
                Buffer.from(result.stdout).toString('utf8').trim() !==
                `${expected.dev}:${expected.ino}`
            )
                throw new Error('Unexpected controller maintenance executable')
        }
        const after = processStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'))
        if (before !== after) throw new Error('Controller maintenance process changed')
        return after
    } catch (error) {
        if (missing(error)) return null
        throw error
    }
}

export async function prepareControllerMaintenance(id: string, controllerPid: number) {
    z.uuid().parse(id)
    pidSchema.parse(controllerPid)
    await requireRootControl()
    for (const path of [requestPath, receiptPath, ownedPath]) {
        try {
            await lstat(path)
            throw new Error('Controller maintenance is already active')
        } catch (error) {
            if (!missing(error)) throw error
        }
    }
    const controllerStartTicks = await processIdentity(
        controllerPid,
        '/usr/local/bin/rentnerproxy-controller',
    )
    if (!controllerStartTicks) throw new Error('Controller is not running')
    const receipt = await open(receiptPath, 'wx', 0o600)
    try {
        await receipt.chown(10001, 10001)
        await receipt.sync()
    } finally {
        await receipt.close()
    }
    await writePrivateJson(
        requestPath,
        {
            id,
            controllerPid,
            controllerStartTicks,
            expiresAt: Date.now() + 60_000,
        },
        { gid: 10001, mode: 0o440 },
    )
}

export async function claimControllerMaintenance(id: string): Promise<number | null> {
    z.uuid().parse(id)
    await requireRootControl()
    const request = requestSchema.parse(await readPrivateJson(requestPath, 1024))
    if (request.id !== id) throw new Error('Controller maintenance request changed')
    const file = await open(
        receiptPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    let receipt: z.infer<typeof receiptSchema>
    try {
        const info = await file.stat()
        if (
            !info.isFile() ||
            info.nlink !== 1 ||
            info.uid !== 10001 ||
            info.gid !== 10001 ||
            (info.mode & 0o7777) !== 0o600 ||
            info.size > 1024
        )
            throw new Error('Unsafe controller maintenance receipt')
        const bytes = Buffer.alloc(1025)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 1024) throw new Error('Controller maintenance receipt is too large')
        receipt = receiptSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')))
        if (receipt.id !== id || receipt.controllerPid !== request.controllerPid)
            throw new Error('Controller maintenance receipt changed')
        await file.chown(0, 0)
        await file.chmod(0o600)
        await file.sync()
    } finally {
        await file.close()
    }
    if (
        receipt.caddyPid !== null &&
        (await processIdentity(receipt.caddyPid, '/usr/bin/caddy')) !== receipt.caddyStartTicks
    )
        throw new Error('Caddy maintenance ownership could not be confirmed')
    await writePrivateJson(ownedPath, receipt)
    const active = z
        .strictObject({ id: z.uuid(), kind: z.literal('restore').optional() })
        .parse(await readPrivateJson(join(controlRoot, 'active.json'), 1024))
    if (active.id !== id) throw new Error('Controller maintenance operation changed')
    if (active.kind === 'restore')
        await writePrivateJson(join(controlRoot, 'restore-progress.json'), {
            id,
            phase: 'preparing',
            progressPercent: 3,
        })
    return receipt.caddyPid
}

export async function assertRetainedCaddy(id: string, pid: number): Promise<void> {
    z.uuid().parse(id)
    pidSchema.parse(pid)
    await requireRootControl()
    const receipt = receiptSchema.parse(await readPrivateJson(ownedPath, 1024))
    if (
        receipt.id !== id ||
        receipt.caddyPid !== pid ||
        (await processIdentity(pid, '/usr/bin/caddy')) !== receipt.caddyStartTicks
    )
        throw new Error('Caddy maintenance ownership changed')
}

export async function finishControllerMaintenance(id: string): Promise<void> {
    z.uuid().parse(id)
    await requireRootControl()
    let receipt: z.infer<typeof receiptSchema>
    try {
        receipt = receiptSchema.parse(await readPrivateJson(ownedPath, 1024))
    } catch (error) {
        if (missing(error)) return
        throw error
    }
    if (receipt.id !== id) throw new Error('Controller maintenance operation changed')
    const pid = receipt.caddyPid
    if (pid !== null) {
        const sameProcess = async () => (await processIdentity(pid)) === receipt.caddyStartTicks
        if (await sameProcess()) {
            await assertRetainedCaddy(id, pid)
            process.kill(pid, 'SIGTERM')
            const until = performance.now() + 2_000
            while (performance.now() < until && (await sameProcess())) await Bun.sleep(50)
            if (await sameProcess()) process.kill(pid, 'SIGKILL')
            const reapUntil = performance.now() + 1_000
            while (performance.now() < reapUntil && (await sameProcess())) await Bun.sleep(25)
            if (await sameProcess()) throw new Error('Retained Caddy did not stop')
        }
    }
    for (const path of [requestPath, receiptPath, ownedPath]) await rm(path)
}
