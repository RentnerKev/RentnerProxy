import type { LiveTopic } from './events.types.ts'

export type LiveStatus = 'connecting' | 'connected' | 'disconnected' | 'inactive'

export interface RealtimeSubscriptionOptions<T> {
    readonly topic: LiveTopic
    readonly query: object
    readonly onData: (data: T) => void | Promise<void>
    readonly onStatus?: (status: LiveStatus) => void
    readonly onUnauthorized?: () => void
    readonly onResume?: () => void
}

export interface Listener {
    readonly id: number
    readonly onData: (data: unknown) => void | Promise<void>
    readonly onStatus?: (status: LiveStatus) => void
    readonly onUnauthorized?: () => void
    readonly onResume?: () => void
    subscriptionKey: string
}

export interface Subscription {
    readonly key: string
    readonly topic: LiveTopic
    readonly queryText: string
    readonly query: object
    readonly listeners: Set<Listener>
}
