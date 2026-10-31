import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'

const cwd = resolve(import.meta.dir, '../../../../../..')
const child = (script: string) => [process.execPath, '--no-env-file', '-e', script]

describe('maintenance process deadline includes all I/O', () => {
    test('preserves binary stdin/stdout and drains stderr concurrently', async () => {
        const input = Uint8Array.from({ length: 200_000 }, (_, index) => index % 256)
        const result = await runMaintenanceProcess(
            child(
                "process.stderr.write('diagnostic'); process.stdout.write(await Bun.stdin.bytes())",
            ),
            { cwd, timeoutMs: 5_000, input },
        )
        expect(result.failed).toBe(false)
        expect(result.stopped).toBe(true)
        expect(result.stdout).toEqual(input)
        expect(result.stderr).toBe('diagnostic')
    })

    test('bounds a blocked input flush and kills a SIGTERM-ignoring child', async () => {
        const result = await runMaintenanceProcess(
            child("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
            { cwd, timeoutMs: 100, input: new Uint8Array(4 * 1024 * 1024) },
        )
        expect(result.timedOut).toBe(true)
        expect(result.failed).toBe(true)
        expect(result.stopped).toBe(true)
    })

    test('fails closed when the child exits before consuming input', async () => {
        const result = await runMaintenanceProcess(child('process.exit(0)'), {
            cwd,
            timeoutMs: 5_000,
            input: new Uint8Array(4 * 1024 * 1024),
        })
        expect(result.failed).toBe(true)
        expect(result.timedOut).toBe(false)
        expect(result.stopped).toBe(true)
    })

    test.skipIf(process.platform === 'win32')(
        'bounds inherited pipes even when the command itself exits successfully',
        async () => {
            const result = await runMaintenanceProcess(
                child(
                    "Bun.spawn([process.execPath, '--no-env-file', '-e', 'setInterval(() => {}, 1000)'], {stdout:'inherit',stderr:'inherit',stdin:'ignore'}); process.exit(0)",
                ),
                { cwd, timeoutMs: 200 },
            )
            expect(result.exitCode).toBe(0)
            expect(result.timedOut).toBe(true)
            expect(result.failed).toBe(true)
            expect(result.stopped).toBe(true)
        },
    )

    test('retains bounded diagnostic context and unsuccessful exit status', async () => {
        const result = await runMaintenanceProcess(
            child(
                "process.stderr.write('x'.repeat(100_000) + 'RESTORE_PHASE=execute'); process.exitCode = 7",
            ),
            { cwd, timeoutMs: 5_000 },
        )
        expect(result.failed).toBe(true)
        expect(result.exitCode).toBe(7)
        expect(result.timedOut).toBe(false)
        expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(65_536)
        expect(result.stderr).toContain('RESTORE_PHASE=execute')
    })

    test('rejects invalid timeout before dispatch', async () => {
        await expect(runMaintenanceProcess([], { cwd, timeoutMs: Infinity })).rejects.toThrow(
            'positive and finite',
        )
    })
})

async function abortReadyChild(descendant: boolean) {
    await mkdir(join(cwd, 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(cwd, 'tmp', 'maintenance-abort-'))
    const marker = join(directory, 'ready')
    const controller = new AbortController()
    let resolveReady: (() => void) | undefined
    const ready = new Promise<void>((resolveSignal) => {
        resolveReady = resolveSignal
    })
    const watcher = watch(directory, (_, filename) => {
        if (filename === 'ready') resolveReady?.()
    })
    let result: ReturnType<typeof runMaintenanceProcess> | undefined
    try {
        const script = `
            process.on('SIGTERM', () => {})
            const nested = process.env.MAINTENANCE_ABORT_DESCENDANT === '1'
                ? Bun.spawn([process.execPath, '--no-env-file', '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdout: 'inherit', stderr: 'inherit', stdin: 'ignore' })
                : null
            const marker = process.env.MAINTENANCE_ABORT_MARKER
            if (!marker) throw new Error('Missing fixture marker')
            await Bun.write(marker + '.tmp', JSON.stringify({ pid: process.pid, nested: nested?.pid ?? null }))
            await (await import('node:fs/promises')).rename(marker + '.tmp', marker)
            setInterval(() => {}, 1000)
        `
        result = runMaintenanceProcess(child(script), {
            cwd,
            timeoutMs: 5_000,
            signal: controller.signal,
            env: {
                ...process.env,
                MAINTENANCE_ABORT_MARKER: marker,
                MAINTENANCE_ABORT_DESCENDANT: descendant ? '1' : '0',
            },
        })
        await Promise.race([
            ready,
            result.then(() => {
                throw new Error('child exited before readiness')
            }),
        ])
        const pids = JSON.parse(await readFile(marker, 'utf8')) as {
            pid: number
            nested: number | null
        }
        controller.abort()
        const completed = await result
        expect(completed.failed).toBe(true)
        expect(completed.stopped).toBe(true)
        expect(completed.timedOut).toBe(false)
        expect(() => process.kill(pids.pid, 0)).toThrow()
        if (pids.nested !== null) {
            if (process.platform === 'linux') {
                let status: string | undefined
                try {
                    status = await readFile(`/proc/${pids.nested}/stat`, 'utf8')
                } catch (error) {
                    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                        throw error
                }
                // A killed grandchild can briefly remain as an orphan zombie awaiting init's reap.
                if (status !== undefined) expect(status).toMatch(/\) Z /u)
            } else expect(() => process.kill(pids.nested!, 0)).toThrow()
        }
    } finally {
        controller.abort()
        await result
        watcher.close()
        await rm(directory, { recursive: true, force: true })
    }
}

test('mid-process abort kills and reaps an owned SIGTERM-ignoring child', () =>
    abortReadyChild(false))

test.skipIf(process.platform === 'win32')(
    'mid-process abort kills the inherited process group',
    () => abortReadyChild(true),
)

test('pre-aborted maintenance never attempts process dispatch', async () => {
    const reason = new Error('synthetic maintenance cancellation')
    const controller = new AbortController()
    controller.abort(reason)
    await expect(
        runMaintenanceProcess(['nonexistent-fixture-that-must-not-spawn'], {
            cwd,
            timeoutMs: 5_000,
            signal: controller.signal,
        }),
    ).rejects.toBe(reason)
})

test('capped stdout fails and stops an otherwise long-running child', async () => {
    const result = await runMaintenanceProcess(
        child(
            "process.on('SIGTERM', () => {}); process.stdout.write(Buffer.alloc(131072, 97)); setInterval(() => {}, 1000)",
        ),
        { cwd, timeoutMs: 5_000, maximumOutputBytes: 1_024 },
    )
    expect(result.failed).toBe(true)
    expect(result.stopped).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.stdout.byteLength).toBeLessThanOrEqual(1_024)
    expect(result.artifact).toBeUndefined()
})
