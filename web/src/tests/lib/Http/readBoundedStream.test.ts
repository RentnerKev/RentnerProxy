import { expect, spyOn, test } from 'bun:test'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'

test('reads ordered byte chunks at the exact limit and releases the reader', async () => {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(Uint8Array.of(0, 255))
            controller.enqueue(Uint8Array.of(128, 1))
            controller.close()
        },
    })
    expect(await readBoundedStream(body, 4)).toEqual(Uint8Array.of(0, 255, 128, 1))
    expect(body.locked).toBe(false)
})

test('an empty stream is valid at a zero-byte limit', async () => {
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
    expect(await readBoundedStream(body, 0)).toEqual(new Uint8Array())
    expect(body.locked).toBe(false)
})

test.each(['hang', 'reject'] as const)(
    'overflow releases the reader without waiting for %s cancellation',
    async (mode) => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(Uint8Array.of(1, 2))
                controller.enqueue(Uint8Array.of(3, 4))
            },
            cancel() {
                cancelled = true
                return mode === 'hang'
                    ? new Promise<void>(() => {})
                    : Promise.reject(new Error('cleanup failed'))
            },
        })
        await expect(readBoundedStream(body, 3)).rejects.toBeInstanceOf(ResponseBodyLimitError)
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    },
    1_000,
)

test.each(['hang', 'reject'] as const)(
    'abort unblocks a pending read despite %s cancellation',
    async (mode) => {
        const controller = new AbortController()
        const failure = new Error('caller aborted')
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true
                return mode === 'hang'
                    ? new Promise<void>(() => {})
                    : Promise.reject(new Error('cleanup failed'))
            },
        })
        const reading = readBoundedStream(body, 10, controller.signal)
        expect(body.locked).toBe(true)
        controller.abort(failure)
        await expect(reading).rejects.toBe(failure)
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    },
    1_000,
)

test('an already aborted signal cancels and releases without returning bytes', async () => {
    const failure = new Error('already aborted')
    const body = new ReadableStream<Uint8Array>()
    await expect(readBoundedStream(body, 10, AbortSignal.abort(failure))).rejects.toBe(failure)
    expect(body.locked).toBe(false)
})

test('a raw read failure retains its exact identity despite cancellation cleanup', async () => {
    const failure = new Error('raw upstream error')
    const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.error(failure),
    })
    await expect(readBoundedStream(body, 10)).rejects.toBe(failure)
    expect(body.locked).toBe(false)
})

test('removes its abort listener when reading completes', async () => {
    const controller = new AbortController()
    const add = spyOn(controller.signal, 'addEventListener')
    const remove = spyOn(controller.signal, 'removeEventListener')
    try {
        await readBoundedStream(
            new ReadableStream({ start: (source) => source.close() }),
            10,
            controller.signal,
        )
        expect(add).toHaveBeenCalledTimes(1)
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1])
    } finally {
        add.mockRestore()
        remove.mockRestore()
    }
})
