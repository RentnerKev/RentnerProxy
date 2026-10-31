// oxlint-disable no-await-in-loop -- Pipe draining and backpressure-aware input must remain ordered.
import type {
    MaintenanceProcessOptions,
    MaintenanceProcessResult,
} from './Types/maintenance-process.types.ts'
import { createHash } from 'node:crypto'
import { writeFileChunk } from './artifact-file.ts'

export async function runMaintenanceProcess(
    args: readonly string[],
    options: MaintenanceProcessOptions,
): Promise<MaintenanceProcessResult> {
    options.signal?.throwIfAborted()
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
        throw new Error('Maintenance process timeout must be positive and finite')
    const deadline = performance.now() + options.timeoutMs
    const child = Bun.spawn({
        cmd: [...args],
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdin: options.input === undefined ? 'ignore' : 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        detached: process.platform !== 'win32',
        windowsHide: true,
    })
    const output = child.stdout.getReader()
    const errors = child.stderr.getReader()
    const chunks: Uint8Array[] = []
    const hash = createHash('sha256')
    let written = 0
    let buffered = 0
    let diagnostic = Buffer.alloc(0)
    let timedOut = false
    let failed = false
    let interrupted = false
    let stopped = false
    let exitCode: number | null = null
    const exited = child.exited.then((code) => {
        stopped = true
        exitCode = code
    })
    const stdout = (async () => {
        while (true) {
            const next = await output.read()
            if (next.done) return
            if (options.outputFile) {
                if (written + next.value.length > options.outputFile.maximumBytes)
                    throw new Error('backup artifact is too large')
                for (let offset = 0; offset < next.value.length; offset += 65_536) {
                    const chunk = next.value.subarray(offset, offset + 65_536)
                    await writeFileChunk(options.outputFile.file, chunk)
                    hash.update(chunk)
                    written += chunk.length
                }
            } else {
                buffered += next.value.length
                if (
                    options.maximumOutputBytes !== undefined &&
                    buffered > options.maximumOutputBytes
                )
                    throw new Error('maintenance output is too large')
                chunks.push(next.value)
            }
        }
    })()
    const stderr = (async () => {
        while (true) {
            const next = await errors.read()
            if (next.done) return
            // Retain bounded diagnostic context, never print raw subprocess stderr.
            const bytes = Buffer.concat([diagnostic, next.value])
            diagnostic =
                bytes.length <= 65_536
                    ? bytes
                    : Buffer.concat([bytes.subarray(0, 32_768), bytes.subarray(-32_768)])
        }
    })()
    const input = (async () => {
        if (options.input === undefined || !child.stdin) return
        for (let offset = 0; offset < options.input.length; offset += 65_536) {
            // Windows pipe writes can reject asynchronously when termination closes stdin.
            await child.stdin.write(options.input.subarray(offset, offset + 65_536))
            await child.stdin.flush()
        }
        await child.stdin.end()
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel: (() => void) | undefined
    const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('maintenance cancelled'))
        options.signal?.addEventListener('abort', cancel, { once: true })
        if (options.signal?.aborted) cancel()
    })
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => {
                timedOut = true
                reject(new Error('maintenance deadline exceeded'))
            },
            Math.max(1, deadline - performance.now()),
        )
    })
    try {
        await Promise.race([Promise.all([exited, stdout, stderr, input]), expired, cancelled])
        // A delayed timer must not turn an operation finishing after its budget into success.
        timedOut ||= performance.now() > deadline
        interrupted = timedOut
        failed = timedOut || exitCode !== 0
    } catch {
        failed = true
        interrupted = true
    } finally {
        clearTimeout(timer)
        if (cancel) options.signal?.removeEventListener('abort', cancel)
        if (interrupted) {
            if (process.platform !== 'win32') {
                try {
                    process.kill(-child.pid, 'SIGKILL')
                } catch {
                    /* The owned group may already be gone. */
                }
            }
            try {
                child.kill('SIGKILL')
            } catch {
                /* The process may already have exited. */
            }
            void output.cancel().catch(() => undefined)
            void errors.cancel().catch(() => undefined)
            // Observe every pending task, including an input flush blocked by a non-reader.
            void Promise.allSettled([stdout, stderr, input])
            let reapTimer: ReturnType<typeof setTimeout> | undefined
            await Promise.race([
                exited,
                new Promise<void>((resolve) => {
                    reapTimer = setTimeout(resolve, 1_000)
                }),
            ])
            clearTimeout(reapTimer)
        }
    }
    return {
        exitCode,
        failed,
        timedOut,
        stopped,
        stdout: Buffer.concat(chunks),
        stderr: diagnostic.toString('utf8'),
        ...(options.outputFile && !failed
            ? { artifact: { bytes: written, sha256: hash.digest('hex') } }
            : {}),
    }
}
