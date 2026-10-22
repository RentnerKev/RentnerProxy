import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'

export { ResponseBodyLimitError }

export async function readBoundedBytes(
    response: Response,
    limit: number,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
        void response.body?.cancel().catch(() => {})
        throw new ResponseBodyLimitError()
    }
    if (!response.body) return new Uint8Array()
    return readBoundedStream(response.body, limit, signal)
}

export async function readBoundedText(
    response: Response,
    limit: number,
    signal?: AbortSignal,
): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(
        await readBoundedBytes(response, limit, signal),
    )
}
