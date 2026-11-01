import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { BACKUP_DOWNLOAD_TIMEOUTS } from '@/config/backup-download.config.ts'
import { createBackupDownloadTimeout } from '@/lib/Http/backupDownloadTimeout.ts'
import {
    getControllerBaseUrl,
    getControllerToken,
    isLoopbackControllerUrl,
} from '@/server/env.server.ts'

export async function downloadBackupController(
    id: string,
    signal: AbortSignal,
    timings = BACKUP_DOWNLOAD_TIMEOUTS,
): Promise<Response> {
    if (id !== id.toLowerCase() || !z.uuid().safeParse(id).success)
        throw new Error('invalid backup id')
    const baseUrl = getControllerBaseUrl()
    const token = getControllerToken()
    if (
        !baseUrl ||
        !token ||
        (!isLoopbackControllerUrl(baseUrl) && !baseUrl.startsWith('https://'))
    )
        throw new Error('backup controller unavailable')
    const stop = new AbortController()
    const abort = () => stop.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const timeout = createBackupDownloadTimeout(
        abort,
        {
            ...timings,
            preparationMs: timings.preparationMs + 3 * timings.connectionMs,
        },
        false,
    )
    const cleanup = () => {
        timeout.clear()
        signal.removeEventListener('abort', abort)
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const releaseReader = (cancel = false) => {
        const current = reader
        reader = undefined
        if (!current) return
        if (cancel) void current.cancel().catch(() => {})
        current.releaseLock()
    }
    try {
        const response = await fetch(baseUrl + '/internal/v1/backups/' + id + '/download', {
            headers: { authorization: 'Bearer ' + token, accept: 'application/x-tar' },
            signal: stop.signal,
            redirect: 'error',
        })
        if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            cleanup()
            return Response.json(
                {
                    error:
                        response.status === 404
                            ? 'not_found'
                            : response.status === 409
                              ? 'conflict'
                              : 'unavailable',
                },
                { status: response.status === 404 ? 404 : response.status === 409 ? 409 : 503 },
            )
        }
        const contentLength = response.headers.get('content-length')
        const verifiedLength = response.headers.get('x-rentnerproxy-backup-bytes')
        const rawLength = verifiedLength ?? contentLength
        const length = rawLength && /^\d+$/u.test(rawLength) ? Number(rawLength) : NaN
        if (
            !response.body ||
            response.headers.get('content-type') !== 'application/x-tar' ||
            !Number.isSafeInteger(length) ||
            length < 1024 ||
            length > 32 * 1024 ** 3 + 65_536 ||
            (contentLength !== null &&
                (!/^\d+$/u.test(contentLength) || Number(contentLength) !== length))
        ) {
            void response.body?.cancel().catch(() => {})
            throw new Error('invalid backup response')
        }
        reader = response.body.getReader()
        timeout.streaming()
        let remaining = length
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                stop.signal.addEventListener(
                    'abort',
                    () => {
                        controller.error(new Error('backup download unavailable'))
                        cleanup()
                        releaseReader(true)
                    },
                    { once: true },
                )
                if (stop.signal.aborted) {
                    controller.error(new Error('backup download unavailable'))
                    cleanup()
                    releaseReader(true)
                }
            },
            async pull(controller) {
                try {
                    stop.signal.throwIfAborted()
                    const result = await reader!.read()
                    if (result.done) {
                        if (remaining !== 0) throw new Error('truncated backup response')
                        controller.close()
                        cleanup()
                        releaseReader()
                        return
                    }
                    remaining -= result.value.length
                    if (remaining < 0) throw new Error('invalid backup response size')
                    if (result.value.length > 0) timeout.progress()
                    controller.enqueue(result.value)
                    if (remaining === 0) {
                        controller.close()
                        cleanup()
                        releaseReader(true)
                    }
                } catch {
                    controller.error(new Error('backup download unavailable'))
                    stop.abort()
                    cleanup()
                    releaseReader(true)
                }
            },
            cancel() {
                stop.abort()
                cleanup()
                releaseReader(true)
            },
        })
        return new Response(body, {
            headers: {
                'Content-Type': 'application/x-tar',
                'Content-Length': String(length),
                'X-Rentnerproxy-Backup-Bytes': String(length),
            },
        })
    } catch {
        stop.abort()
        cleanup()
        releaseReader(true)
        throw new Error('backup download unavailable')
    }
}
