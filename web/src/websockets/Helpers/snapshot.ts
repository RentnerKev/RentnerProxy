import {
    LIVE_MAX_QUERY_BYTES,
    LIVE_MAX_PAYLOAD_BYTES,
    LIVE_SNAPSHOT_PATH,
    LIVE_TOPICS,
    type LiveTopic,
} from './realtimeConstants'

export class LivePayloadError extends Error {
    constructor() {
        super('Live snapshot payload is too large or invalid.')
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength
}

export function normalizeOrigin(value: string | null | undefined): string | null {
    if (!value) return null

    try {
        const origin = new URL(value)
        if (
            (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
            origin.username ||
            origin.password ||
            origin.pathname !== '/' ||
            origin.search ||
            origin.hash ||
            !origin.hostname
        ) {
            return null
        }
        return origin.toString().replace(/\/$/u, '')
    } catch {
        return null
    }
}

export function statusResponse(status: number): Response {
    return new Response(null, {
        status,
        headers: {
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

export function isWebSocketUpgrade(request: Request): boolean {
    return request.headers.get('upgrade')?.trim().toLowerCase() === 'websocket'
}

export function topicFrom(value: unknown): LiveTopic | null {
    return typeof value === 'string' && (LIVE_TOPICS as readonly string[]).includes(value)
        ? (value as LiveTopic)
        : null
}

export function parseQuery(
    query: unknown,
    maxQueryBytes = LIVE_MAX_QUERY_BYTES,
): {
    query: unknown
    queryText: string
} | null {
    if (!isRecord(query)) return null
    const queryText = JSON.stringify(query)
    if (queryText === undefined || byteLength(queryText) > maxQueryBytes) return null
    return { query, queryText }
}

function comparableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(comparableValue)
    if (!isRecord(value)) return value

    const entries = Object.entries(value)
        .filter(([key]) => key !== 'snapshotExpiresAt')
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, comparableValue(child)] as const)
    return Object.fromEntries(entries)
}

export function comparisonKey(value: unknown): string {
    const serialized = JSON.stringify(comparableValue(value))
    if (serialized === undefined) throw new LivePayloadError()
    return serialized
}

export function snapshotMessage(
    topic: LiveTopic,
    query: unknown,
    value: unknown,
    maxPayloadBytes = LIVE_MAX_PAYLOAD_BYTES,
): string {
    const serialized = JSON.stringify({ type: 'snapshot', topic, query, payload: value })
    if (serialized === undefined || byteLength(serialized) > maxPayloadBytes) {
        throw new LivePayloadError()
    }
    return serialized
}

export function snapshotUrl(
    requestUrl: string,
    snapshotPath = LIVE_SNAPSHOT_PATH,
    topic: LiveTopic,
    queryText: string,
): string {
    const url = new URL(snapshotPath, requestUrl)
    url.search = ''
    url.searchParams.set('topic', topic)
    url.searchParams.set('query', queryText)
    return url.toString()
}

export async function readBoundedJson(
    response: Response,
    maxPayloadBytes = LIVE_MAX_PAYLOAD_BYTES,
): Promise<unknown> {
    const bodyReader = response.body?.getReader()
    if (!bodyReader) throw new LivePayloadError()
    const reader = bodyReader

    const chunks: Uint8Array[] = []
    async function collect(length: number): Promise<number> {
        const chunk = await reader.read()
        if (chunk.done) return length
        const nextLength = length + chunk.value.byteLength
        if (nextLength > maxPayloadBytes) {
            await reader.cancel()
            throw new LivePayloadError()
        }
        chunks.push(chunk.value)
        return collect(nextLength)
    }

    let length: number
    try {
        length = await collect(0)
    } finally {
        reader.releaseLock()
    }

    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }

    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
        throw new LivePayloadError()
    }
}
