import type { ServerWebSocket } from 'bun'

import {
    LIVE_INTERVALS,
    LIVE_MAX_SUBSCRIPTIONS,
    type LiveTopic,
} from '../Helpers/realtimeConstants'
import { comparisonKey, snapshotMessage } from '../Helpers/snapshot'
import type { LiveSocketData } from '../Types/bun'

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

function unsubscribe(connection: LiveConnectionData, topic: LiveTopic): void {
    const subscription = connection.subscriptions.get(topic)
    if (!subscription) return
    subscription.active = false
    subscription.pending = false
    subscription.abortController?.abort()
    subscription.abortController = null
    if (subscription.abortTimer !== null) clearTimeout(subscription.abortTimer)
    subscription.abortTimer = null
    if (subscription.timer !== null) clearInterval(subscription.timer)
    subscription.timer = null
    connection.subscriptions.delete(topic)
}

interface SubscriptionManagerOptions {
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

export function createSubscriptionManager(options: SubscriptionManagerOptions) {
    async function sample(subscription: LiveTopicSubscription): Promise<void> {
        const { connection } = subscription
        if (!subscription.active || connection.closed) return
        if (subscription.inflight) {
            subscription.pending = true
            return
        }
        subscription.inflight = true
        subscription.pending = false
        const controller = new AbortController()
        subscription.abortController = controller
        subscription.abortTimer = setTimeout(() => controller.abort(), options.snapshotTimeoutMs)
        try {
            const result = await options.readSnapshot(subscription, controller.signal)
            if (!subscription.active || connection.closed) return
            if (result.kind === 'failure') {
                if (result.status === 401 || result.status === 403) {
                    options.closeUnauthorized(connection)
                } else {
                    options.closeUnavailable(connection, result.status ?? 503)
                }
                return
            }

            let comparison: string
            let message: string
            try {
                comparison = comparisonKey(result.data)
                message = snapshotMessage(
                    subscription.topic,
                    subscription.query,
                    result.data,
                    options.maxPayloadBytes,
                )
            } catch {
                options.closeUnavailable(connection, 413)
                return
            }
            if (comparison === subscription.lastComparison) return
            const ws = connection.ws
            if (!ws || ws.sendText(message) <= 0) {
                options.closeBackpressured(connection)
                return
            }
            subscription.lastComparison = comparison
        } finally {
            subscription.inflight = false
            if (subscription.abortTimer !== null) clearTimeout(subscription.abortTimer)
            subscription.abortTimer = null
            subscription.abortController = null
            if (subscription.pending && subscription.active && !connection.closed) {
                subscription.pending = false
                queueMicrotask(() => void sample(subscription))
            }
        }
    }

    function subscribe(
        connection: LiveConnectionData,
        topic: LiveTopic,
        query: unknown,
        queryText: string,
    ): boolean {
        const existing = connection.subscriptions.get(topic)
        if (!existing && connection.subscriptions.size >= LIVE_MAX_SUBSCRIPTIONS) return false
        if (existing) unsubscribe(connection, topic)
        const subscription: LiveTopicSubscription = {
            connection,
            topic,
            query,
            queryText,
            intervalMs: LIVE_INTERVALS[topic],
            timer: null,
            abortController: null,
            abortTimer: null,
            inflight: false,
            pending: false,
            lastComparison: null,
            active: true,
        }
        connection.subscriptions.set(topic, subscription)
        subscription.timer = setInterval(() => void sample(subscription), subscription.intervalMs)
        void sample(subscription)
        return true
    }

    function dispose(connection: LiveConnectionData): void {
        for (const topic of connection.subscriptions.keys()) unsubscribe(connection, topic)
        connection.handshakeAbortController?.abort()
        connection.handshakeAbortController = null
    }

    function sampleAll(): void {
        for (const connection of connections) {
            for (const subscription of connection.subscriptions.values()) void sample(subscription)
        }
    }

    const connections = new Set<LiveConnectionData>()

    const manager: LiveSubscriptionManager = {
        connections,
        sample,
        sampleAll,
        subscribe,
        unsubscribe,
        dispose,
    }
    return manager
}
