import { LIVE_MAX_PAYLOAD_BYTES, type LiveTopic } from './realtimeConstants'
import { readBoundedJson, snapshotUrl } from './snapshot'
import type { LiveConnectionData, LiveTopicSubscription } from '../Server/realtimeSubscriptions'
import type { LiveSnapshotReader } from '../Types/bun'

export interface LiveReadResult {
    readonly kind: 'success' | 'failure'
    readonly data?: unknown
    readonly status?: number
}

function handshakeSubscription(connection: LiveConnectionData): LiveTopicSubscription {
    return {
        connection,
        topic: 'app-events',
        query: {},
        queryText: '{}',
        intervalMs: 60_000,
        timer: null,
        abortController: null,
        abortTimer: null,
        inflight: false,
        pending: false,
        lastComparison: null,
        active: true,
    }
}

function abortable<T>(
    signal: AbortSignal,
    onAbort: () => void,
): {
    readonly promise: Promise<T>
    readonly cleanup: () => void
} {
    let handler: (() => void) | null = null
    const promise = new Promise<T>((_, reject) => {
        handler = () => {
            onAbort()
            reject(new DOMException('Snapshot read aborted.', 'AbortError'))
        }
        if (signal.aborted) handler()
        else signal.addEventListener('abort', handler, { once: true })
    })
    return {
        promise,
        cleanup: () => {
            if (handler !== null) signal.removeEventListener('abort', handler)
        },
    }
}

export async function readSubscriptionSnapshot(
    subscription: LiveTopicSubscription,
    signal: AbortSignal,
    readSnapshot: (
        request: Request,
        context: { request: Request; topic: LiveTopic; query: unknown },
    ) => Response | Promise<Response>,
    getSnapshotUrl: (subscription: LiveTopicSubscription) => string,
    maxPayloadBytes = LIVE_MAX_PAYLOAD_BYTES,
): Promise<LiveReadResult> {
    const headers = new Headers()
    if (subscription.connection.cookie !== null) {
        headers.set('cookie', subscription.connection.cookie)
    }
    headers.set('origin', subscription.connection.origin)
    const request = new Request(getSnapshotUrl(subscription), { method: 'GET', headers, signal })
    let response: Response
    const responseAbort = abortable<Response>(signal, () => undefined)
    try {
        const responsePromise = Promise.resolve(
            readSnapshot(request, {
                request,
                topic: subscription.topic,
                query: subscription.query,
            }),
        ).then((result) => {
            if (signal.aborted) void result.body?.cancel().catch(() => undefined)
            return result
        })
        response = await Promise.race([responsePromise, responseAbort.promise])
    } catch {
        responseAbort.cleanup()
        return { kind: 'failure', status: 503 }
    }
    responseAbort.cleanup()
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'failure', status: response.status }
    }
    const bodyAbort = abortable<unknown>(signal, () => {
        void response.body?.cancel().catch(() => undefined)
    })
    try {
        const data = await Promise.race([
            readBoundedJson(response, maxPayloadBytes),
            bodyAbort.promise,
        ])
        return { kind: 'success', data }
    } catch {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'failure', status: signal.aborted ? 503 : 413 }
    } finally {
        bodyAbort.cleanup()
    }
}

export async function readLiveHandshake(
    connection: LiveConnectionData,
    snapshotPath: string,
    snapshotTimeoutMs: number,
    maxPayloadBytes: number,
    readSnapshot: LiveSnapshotReader,
): Promise<number> {
    const controller = new AbortController()
    connection.handshakeAbortController = controller
    const timer = setTimeout(() => controller.abort(), snapshotTimeoutMs)
    try {
        const subscription = handshakeSubscription(connection)
        const result = await readSubscriptionSnapshot(
            subscription,
            controller.signal,
            readSnapshot,
            (current) =>
                snapshotUrl(connection.requestUrl, snapshotPath, current.topic, current.queryText),
            maxPayloadBytes,
        )
        return result.kind === 'failure' ? (result.status ?? 503) : 200
    } finally {
        clearTimeout(timer)
        connection.handshakeAbortController = null
    }
}
