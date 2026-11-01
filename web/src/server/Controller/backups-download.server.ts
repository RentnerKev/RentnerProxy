import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
    getControllerBaseUrl,
    getControllerToken,
    isLoopbackControllerUrl,
} from '@/server/env.server.ts'

export async function downloadBackupController(id: string, signal: AbortSignal): Promise<Response> {
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
    const timeout = setTimeout(abort, 300_000)
    const cleanup = () => {
        clearTimeout(timeout)
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
        const rawLength = response.headers.get('content-length')
        const length = rawLength && /^\d+$/u.test(rawLength) ? Number(rawLength) : NaN
        if (
            !response.body ||
            response.headers.get('content-type') !== 'application/x-tar' ||
            !Number.isSafeInteger(length) ||
            length < 1024 ||
            length > 32 * 1024 ** 3 + 65_536
        ) {
            void response.body?.cancel().catch(() => {})
            throw new Error('invalid backup response')
        }
        reader = response.body.getReader()
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
            },
        })
    } catch {
        stop.abort()
        cleanup()
        releaseReader(true)
        throw new Error('backup download unavailable')
    }
}
