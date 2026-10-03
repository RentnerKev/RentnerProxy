import type { ServerWebSocket } from 'bun'

import type { LiveSocketData } from './bun.types.ts'

import type { LiveTopic } from '@/lib/Live/Types/realtime.types.ts'

export interface LiveConnectionData {
    readonly requestUrl: string
    readonly cookie: string | null
    readonly origin: string
    ws: ServerWebSocket<LiveSocketData> | null
    closed: boolean
    handshakeAbortController: AbortController | null
    subscriptions: Map<LiveTopic, LiveTopicSubscription>
    messageWindowStarted: number
    messageCount: number
}

export interface LiveTopicSubscription {
    readonly connection: LiveConnectionData
    readonly topic: LiveTopic
    readonly query: unknown
    readonly queryText: string
    readonly intervalMs: number
    timer: ReturnType<typeof setInterval> | null
    abortController: AbortController | null
    abortTimer: ReturnType<typeof setTimeout> | null
    inflight: boolean
    pending: boolean
    lastComparison: string | null
    active: boolean
}

export interface SubscriptionManagerOptions {
    readonly readSnapshot: (
        subscription: LiveTopicSubscription,
        signal: AbortSignal,
    ) => Promise<{
        readonly kind: 'success' | 'failure'
        readonly data?: unknown
        readonly status?: number
    }>
    readonly maxPayloadBytes: number
    readonly snapshotTimeoutMs: number
    readonly closeUnauthorized: (connection: LiveConnectionData) => void
    readonly closeUnavailable: (connection: LiveConnectionData, status: number) => void
    readonly closeBackpressured: (connection: LiveConnectionData) => void
}

export interface LiveSubscriptionManager {
    readonly connections: Set<LiveConnectionData>
    readonly sample: (subscription: LiveTopicSubscription) => Promise<void>
    readonly sampleAll: () => void
    readonly subscribe: (
        connection: LiveConnectionData,
        topic: LiveTopic,
        query: unknown,
        queryText: string,
    ) => boolean
    readonly unsubscribe: (connection: LiveConnectionData, topic: LiveTopic) => void
    readonly dispose: (connection: LiveConnectionData) => void
}
