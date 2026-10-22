import { describe, expect, test } from 'bun:test'

import { readBoundedJson } from '@/lib/Live/snapshot.ts'

describe('bounded live snapshot reading', () => {
    test('decodes JSON split across UTF-8 chunks and releases its reader', async () => {
        const value = { message: 'Grüße ☕' }
        const bytes = new TextEncoder().encode(JSON.stringify(value))
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
                controller.close()
            },
        })
        expect(await readBoundedJson(new Response(body), bytes.length)).toEqual(value)
        expect(body.locked).toBe(false)
    })

    test('cancels a snapshot exceeding its byte limit and releases its reader', async () => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"value":1}'))
            },
            cancel() {
                cancelled = true
            },
        })
        await expect(readBoundedJson(new Response(body), 10)).rejects.toThrow()
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    })

    test('counts the limit across chunks', async () => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"value":'))
                controller.enqueue(new TextEncoder().encode('1}'))
            },
            cancel() {
                cancelled = true
            },
        })
        await expect(readBoundedJson(new Response(body), 10)).rejects.toThrow()
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    })

    test('rejects malformed JSON and releases its reader', async () => {
        const response = new Response('{')
        await expect(readBoundedJson(response)).rejects.toThrow()
        expect(response.body?.locked).toBe(false)
    })

    test('propagates a failed stream read and releases its reader', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('upstream read failed'))
            },
        })
        await expect(readBoundedJson(new Response(body))).rejects.toThrow('upstream read failed')
        expect(body.locked).toBe(false)
    })

    test('rejects a missing response body', async () => {
        await expect(readBoundedJson(new Response(null))).rejects.toThrow()
    })

    test('retains replacement decoding, BOM stripping and header-independent byte limits', async () => {
        const bytes = Uint8Array.of(123, 34, 118, 34, 58, 34, 255, 34, 125)
        expect(await readBoundedJson(new Response(bytes))).toEqual({ v: '\uFFFD' })
        expect(
            await readBoundedJson(
                new Response('\uFEFF{}', { headers: { 'content-length': '999' } }),
                5,
            ),
        ).toEqual({})
    })

    test('keeps the exact raw stream error rather than converting it to a payload error', async () => {
        const failure = new Error('same raw error')
        const body = new ReadableStream<Uint8Array>({
            start: (controller) => controller.error(failure),
        })
        await expect(readBoundedJson(new Response(body))).rejects.toBe(failure)
        expect(body.locked).toBe(false)
    })

    test('overflow maps to the existing payload error without waiting for cancellation', async () => {
        const body = new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(Uint8Array.of(1, 2)),
            cancel: () => new Promise<void>(() => {}),
        })
        await expect(readBoundedJson(new Response(body), 1)).rejects.toThrow(
            'Live snapshot payload is too large or invalid.',
        )
        expect(body.locked).toBe(false)
    }, 1_000)

    test('forwards abort to an incomplete body and releases its locked reader', async () => {
        const controller = new AbortController()
        const failure = new Error('stop snapshot')
        const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) })
        const reading = readBoundedJson(new Response(body), 100, controller.signal)
        controller.abort(failure)
        await expect(reading).rejects.toBe(failure)
        expect(body.locked).toBe(false)
    }, 1_000)
})
