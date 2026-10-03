import type {
    LiveConnectionData,
    LiveTopicSubscription,
    SubscriptionManagerOptions,
    LiveSubscriptionManager,
} from './Types/realtime-subscriptions.types.ts'

import { LIVE_INTERVALS, LIVE_MAX_SUBSCRIPTIONS } from '@/config/realtime.config.ts'
import type { LiveTopic } from '@/lib/Live/Types/realtime.types.ts'
import { comparisonKey, snapshotMessage } from '@/lib/Live/snapshot.ts'

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
