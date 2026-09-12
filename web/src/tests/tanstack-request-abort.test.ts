import { describe, expect, spyOn, test } from 'bun:test'
import { getRequestIP, requestHandler } from '@tanstack/react-start/server'

import { createRuntimeFetch } from '../../../docker/web/request-context'
import { withRequestAbortHandling } from '../server/request-abort.server'

describe('application request abort handling with unpatched TanStack', () => {
    test('returns an empty 499 when a pending handler rejects with the request abort reason', async () => {
        const controller = new AbortController()
        const abortReason = new Error('client disconnected')
        let rejectHandler: (() => void) | undefined

        const handler = withRequestAbortHandling(
            requestHandler(
                (request) =>
                    new Promise<never>((_resolve, reject) => {
                        rejectHandler = () => reject(request.signal.reason)
                    }),
            ),
        )
        const responsePromise = handler(
            new Request('http://localhost/disconnected', { signal: controller.signal }),
            {},
        )
        const consoleError = spyOn(console, 'error').mockImplementation(() => {})

        try {
            controller.abort(abortReason)
            rejectHandler?.()
            const response = await responsePromise

            expect(response.status).toBe(499)
            expect(await response.text()).toBe('')
            expect(consoleError).not.toHaveBeenCalled()
        } finally {
            consoleError.mockRestore()
        }
    })

    test('handles a signal that was already aborted before entering TanStack', async () => {
        const handler = withRequestAbortHandling(
            requestHandler(async (request) => {
                request.signal.throwIfAborted()
                return new Response('unexpected')
            }),
        )
        const consoleError = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await handler(
                new Request('http://localhost/aborted', { signal: AbortSignal.abort() }),
                {},
            )
            expect(response.status).toBe(499)
            expect(await response.text()).toBe('')
            expect(consoleError).not.toHaveBeenCalled()
        } finally {
            consoleError.mockRestore()
        }
    })

    test('preserves request bodies, options and the server-owned peer address', async () => {
        const handler = withRequestAbortHandling(
            requestHandler(async (request, options) =>
                Response.json({
                    ip: getRequestIP(),
                    body: await request.text(),
                    method: request.method,
                    contentType: request.headers.get('content-type'),
                    url: request.url,
                    nonce: options?.context?.nonce,
                }),
            ),
        )
        const runtimeFetch = createRuntimeFetch({
            fetch: (request) => handler(request, { context: { nonce: 'test-nonce' } }),
        })
        const response = await runtimeFetch(
            new Request('http://localhost/form?test=1', {
                method: 'POST',
                body: 'hello',
                headers: { 'content-type': 'text/plain', 'x-forwarded-for': '198.51.100.1' },
            }),
            { requestIP: () => ({ address: '127.0.0.1' }) },
        )
        expect(await response.json()).toEqual({
            ip: '127.0.0.1',
            body: 'hello',
            method: 'POST',
            contentType: 'text/plain',
            url: 'http://localhost/form?test=1',
            nonce: 'test-nonce',
        })
    })

    test('propagates cancellation after response headers while a body is streaming', async () => {
        const controller = new AbortController()
        const handler = withRequestAbortHandling(
            requestHandler(
                (request) =>
                    new Response(
                        new ReadableStream({
                            start(stream) {
                                request.signal.addEventListener(
                                    'abort',
                                    () => {
                                        stream.error(request.signal.reason)
                                    },
                                    { once: true },
                                )
                            },
                        }),
                    ),
            ),
        )
        const response = await handler(
            new Request('http://localhost/stream', {
                signal: controller.signal,
            }),
            {},
        )
        const read = response.body!.getReader().read()
        controller.abort(new Error('client disconnected'))
        await expect(read).rejects.toBeInstanceOf(Response)
    })

    test('keeps a genuine rejection when an aborted request has a different error', async () => {
        const controller = new AbortController()
        const abortReason = new Error('client disconnected')
        controller.abort(abortReason)
        const genuineError = new Error('database unavailable')

        const handler = withRequestAbortHandling(
            requestHandler(async () => {
                throw genuineError
            }),
        )

        const consoleError = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await handler(
                new Request('http://localhost/disconnected', { signal: controller.signal }),
                {},
            )

            expect(response.status).toBe(500)
            expect(consoleError).toHaveBeenCalled()
        } finally {
            consoleError.mockRestore()
        }
    })

    test('keeps a genuine rejection when the request remains active', async () => {
        const controller = new AbortController()
        const genuineError = new Error('database unavailable')

        const handler = withRequestAbortHandling(
            requestHandler(async () => {
                throw genuineError
            }),
        )

        const consoleError = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const response = await handler(
                new Request('http://localhost/active', { signal: controller.signal }),
                {},
            )

            expect(response.status).toBe(500)
            expect(consoleError).toHaveBeenCalled()
        } finally {
            consoleError.mockRestore()
        }
    })
})
