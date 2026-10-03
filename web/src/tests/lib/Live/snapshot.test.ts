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
})
