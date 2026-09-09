import { describe, expect, spyOn, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'

describe('TanStack request abort handling', () => {
    test('returns an empty 499 when a pending handler rejects with the request abort reason', async () => {
        const controller = new AbortController()
        const abortReason = new Error('client disconnected')
        let rejectHandler: ((error: unknown) => void) | undefined

        const handler = requestHandler(
            () =>
                new Promise<never>((_resolve, reject) => {
                    rejectHandler = reject
                }),
        )
        const responsePromise = handler(
            new Request('http://localhost/disconnected', { signal: controller.signal }),
            {},
        )
        const consoleError = spyOn(console, 'error').mockImplementation(() => {})

        try {
            controller.abort(abortReason)
            rejectHandler?.(abortReason)
            const response = await responsePromise

            expect(response.status).toBe(499)
            expect(await response.text()).toBe('')
            expect(consoleError).not.toHaveBeenCalled()
        } finally {
            consoleError.mockRestore()
        }
    })

    test('keeps a genuine rejection when an aborted request has a different error', async () => {
        const controller = new AbortController()
        const abortReason = new Error('client disconnected')
        controller.abort(abortReason)
        const genuineError = new Error('database unavailable')

        const handler = requestHandler(async () => {
            throw genuineError
        })

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

        const handler = requestHandler(async () => {
            throw genuineError
        })

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
