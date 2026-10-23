import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { waitForBeta2 } from './wait.ts'
import type { Beta2ControllerInput } from './Types/journeys.types.ts'

export function shouldPrintControllerLine(line: string): boolean {
    try {
        const value: unknown = JSON.parse(line)
        return !(
            value !== null &&
            typeof value === 'object' &&
            'level' in value &&
            (value.level === 'info' || value.level === 'warn') &&
            'ts' in value &&
            typeof value.ts === 'number' &&
            'msg' in value &&
            typeof value.msg === 'string'
        )
    } catch {
        return true
    }
}

export async function startBeta2Controller(input: Beta2ControllerInput, signal?: AbortSignal) {
    const fixture = join(input.directory, 'fixture.json')
    const ready = join(input.directory, 'ready.json')
    const stop = join(input.directory, 'stop')
    await Promise.all([rm(ready, { force: true }), rm(stop, { force: true })])
    await writeFile(fixture, JSON.stringify(input), { mode: 0o600 })
    const child = spawn(
        'cargo',
        [
            'test',
            '--locked',
            '--manifest-path',
            'core/Cargo.toml',
            '--lib',
            'beta2_integration_controller',
            '--',
            '--ignored',
            '--nocapture',
        ],
        {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, RENTNERPROXY_BETA2_FIXTURE: fixture },
        },
    )
    // Drain both pipes throughout compilation and runtime; retain every non-routine diagnostic.
    for (const [stream, destination] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
    ] as const) {
        const lines = createInterface({ input: stream, crlfDelay: Infinity })
        lines.on('line', (line) => {
            if (shouldPrintControllerLine(line)) destination.write(line + '\n')
        })
    }
    let exited = false
    let succeeded = false
    const completion = new Promise<void>((resolve) => {
        child.once('error', () => {
            exited = true
            resolve()
        })
        child.once('exit', (code) => {
            exited = true
            succeeded = code === 0
        })
        // close follows exit only after both output pipes have drained.
        child.once('close', () => resolve())
    })
    const interrupted = () => {
        if (!exited && child.pid) {
            try {
                process.kill(-child.pid, 'SIGTERM')
            } catch {
                /* Already reaped. */
            }
        }
    }
    signal?.addEventListener('abort', interrupted, { once: true })
    if (signal?.aborted) interrupted()
    async function close() {
        signal?.removeEventListener('abort', interrupted)
        if (!exited) await writeFile(stop, '', { mode: 0o600 })
        let timer: ReturnType<typeof setTimeout> | undefined
        const graceful = await Promise.race([
            completion.then(() => true),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), 20_000)
            }),
        ]).finally(() => clearTimeout(timer))
        if (!graceful && child.pid) {
            try {
                process.kill(-child.pid, 'SIGKILL')
            } catch {
                /* Already reaped. */
            }
            await completion
        }
        if (!succeeded) throw new Error('Beta 2 controller did not exit successfully')
    }
    try {
        await waitForBeta2(
            async () => {
                if (signal?.aborted) throw new Error('Beta 2 controller startup aborted')
                if (exited) throw new Error('Beta 2 controller exited before readiness')
                try {
                    await readFile(ready)
                    return true
                } catch {
                    return false
                }
            },
            'controller readiness',
            480_000,
            () => false,
        )
        const value = JSON.parse(await readFile(ready, 'utf8')) as { readonly url?: unknown }
        if (typeof value.url !== 'string') throw new Error('invalid controller readiness')
        const url = new URL(value.url)
        if (
            url.protocol !== 'http:' ||
            url.hostname !== '127.0.0.1' ||
            !url.port ||
            url.pathname !== '/'
        )
            throw new Error('invalid controller readiness')
        return { url: url.origin, close }
    } catch (error) {
        await close().catch(() => undefined)
        throw error
    }
}
