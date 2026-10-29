// oxlint-disable no-await-in-loop
import { randomBytes } from 'node:crypto'
import { link, open, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Beta2SchedulerPauseOptions } from './Types/journeys.types.ts'

class InvalidAcknowledgementError extends Error {}

function duration(value: number | undefined, fallback: number): number {
    const result = value ?? fallback
    if (!Number.isSafeInteger(result) || result < 1 || result > 60_000)
        throw new Error('Invalid Beta 2 scheduler handshake duration')
    return result
}

async function acknowledgement(path: string): Promise<string | undefined> {
    let file: FileHandle
    try {
        file = await open(path, 'r')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
    }
    try {
        const metadata = await file.stat()
        if (!metadata.isFile() || metadata.size < 1 || metadata.size > 128)
            throw new InvalidAcknowledgementError('Invalid Beta 2 scheduler acknowledgement')
        const bytes = Buffer.alloc(129)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead !== metadata.size)
            throw new InvalidAcknowledgementError('Invalid Beta 2 scheduler acknowledgement')
        const match =
            /^[ \t\r\n]*\{[ \t\r\n]*"nonce"[ \t\r\n]*:[ \t\r\n]*"([a-f0-9]{32})"[ \t\r\n]*\}[ \t\r\n]*$/u.exec(
                bytes.subarray(0, bytesRead).toString('utf8'),
            )
        if (!match) {
            throw new InvalidAcknowledgementError('Invalid Beta 2 scheduler acknowledgement')
        }
        return match[1]!
    } finally {
        await file.close()
    }
}

async function waitForAcknowledgement(
    path: string,
    nonce: string,
    released: boolean,
    timeoutMs: number,
    pollIntervalMs: number,
    signal?: AbortSignal,
    tolerateInvalid = false,
): Promise<void> {
    const deadline = performance.now() + timeoutMs
    while (true) {
        signal?.throwIfAborted()
        let current: string | undefined
        try {
            current = await acknowledgement(path)
        } catch (error) {
            if ((!released && !tolerateInvalid) || !(error instanceof InvalidAcknowledgementError))
                throw error
            current = released ? nonce : undefined
        }
        const remaining = deadline - performance.now()
        if (remaining <= 0)
            throw new Error(
                released
                    ? 'Beta 2 scheduler pause release timed out'
                    : 'Beta 2 scheduler pause acknowledgement timed out',
            )
        if (released ? current !== nonce : current === nonce) return
        try {
            await delay(Math.min(pollIntervalMs, remaining), undefined, { signal })
        } catch (error) {
            signal?.throwIfAborted()
            throw error
        }
    }
}

export async function withPausedDdnsScheduler(
    directory: string,
    operation: () => Promise<void>,
    options: Beta2SchedulerPauseOptions = {},
): Promise<void> {
    const timeoutMs = duration(options.timeoutMs, 30_000)
    const releaseTimeoutMs = duration(options.releaseTimeoutMs, timeoutMs)
    const pollIntervalMs = duration(options.pollIntervalMs, 10)
    const nonce = randomBytes(16).toString('hex')
    const request = join(directory, 'ddns-scheduler-pause-request.json')
    const acknowledged = join(directory, 'ddns-scheduler-paused.json')
    const temporary = join(directory, '.ddns-scheduler-pause-' + nonce + '.json')
    let temporaryCreated = false
    let published = false
    let acquired = false
    let failed = false
    let failure: unknown
    const errors: unknown[] = []
    try {
        options.signal?.throwIfAborted()
        const file = await open(temporary, 'wx', 0o600)
        temporaryCreated = true
        try {
            await file.writeFile(JSON.stringify({ nonce }))
        } finally {
            await file.close()
        }
        options.signal?.throwIfAborted()
        await link(temporary, request)
        published = true
        await rm(temporary)
        temporaryCreated = false
        await waitForAcknowledgement(
            acknowledged,
            nonce,
            false,
            timeoutMs,
            pollIntervalMs,
            options.signal,
        )
        acquired = true
        options.signal?.throwIfAborted()
        await operation()
        options.signal?.throwIfAborted()
    } catch (error) {
        failed = true
        failure = error
    } finally {
        if (temporaryCreated) {
            try {
                await rm(temporary, { force: true })
            } catch (error) {
                errors.push(error)
            }
        }
        if (published) {
            try {
                if (!acquired)
                    await waitForAcknowledgement(
                        acknowledged,
                        nonce,
                        false,
                        releaseTimeoutMs,
                        pollIntervalMs,
                        undefined,
                        true,
                    )
                await rm(request, { force: true })
                await waitForAcknowledgement(
                    acknowledged,
                    nonce,
                    true,
                    releaseTimeoutMs,
                    pollIntervalMs,
                )
            } catch (error) {
                errors.push(error)
            }
        }
    }
    if (errors.length && failed) {
        try {
            console.error('Beta 2 scheduler pause release did not complete.')
        } catch {}
    }
    if (failed) throw failure
    if (errors.length) throw errors[0]
}
