import { expect, test } from 'bun:test'
import { ResponseBodyLimitError as SharedLimitError } from '@/lib/Http/readBoundedStream.ts'
import { readBoundedBytes, readBoundedText, ResponseBodyLimitError } from '@/server/Updates/http.ts'

test('keeps the exported limit error identity, name and message', () => {
    expect(ResponseBodyLimitError).toBe(SharedLimitError)
    const error = new ResponseBodyLimitError()
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Response body exceeds limit')
})

test.each(['-1', '1.5', 'invalid', '999999999999999999999999999999999'])(
    'rejects invalid Content-Length %s before reading',
    async (length) => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true
            },
        })
        await expect(
            readBoundedBytes(new Response(body, { headers: { 'content-length': length } }), 10),
        ).rejects.toBeInstanceOf(ResponseBodyLimitError)
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    },
)

test('counts actual bytes even when Content-Length understates the body', async () => {
    await expect(
        readBoundedBytes(new Response('123', { headers: { 'content-length': '1' } }), 2),
    ).rejects.toBeInstanceOf(ResponseBodyLimitError)
})

test('keeps missing-body bytes/text empty while still checking Content-Length', async () => {
    expect(await readBoundedBytes(new Response(null), 0, AbortSignal.abort())).toEqual(
        new Uint8Array(),
    )
    expect(await readBoundedText(new Response(null), 0)).toBe('')
    await expect(
        readBoundedBytes(new Response(null, { headers: { 'content-length': '9' } }), 8),
    ).rejects.toBeInstanceOf(ResponseBodyLimitError)
})

test('keeps fatal UTF-8 decoding and the existing BOM handling', async () => {
    await expect(readBoundedText(new Response(Uint8Array.of(255)), 1)).rejects.toBeInstanceOf(
        TypeError,
    )
    expect(await readBoundedText(new Response('\uFEFF{}'), 5)).toBe('{}')
})

test('header rejection does not wait for cancellation to finish', async () => {
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) })
    await expect(
        readBoundedBytes(new Response(body, { headers: { 'content-length': '11' } }), 10),
    ).rejects.toBeInstanceOf(ResponseBodyLimitError)
    expect(body.locked).toBe(false)
}, 1_000)
