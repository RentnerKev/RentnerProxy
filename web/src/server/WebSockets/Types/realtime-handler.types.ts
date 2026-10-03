import type { LiveConnectionData, LiveSubscriptionManager } from './realtime-subscriptions.types.ts'

export interface Lifecycle {
    readonly close: (connection: LiveConnectionData, code: number, reason: string) => void
    readonly dispose: (connection: LiveConnectionData) => void
}

export interface RealtimeHandlerOptions {
    readonly manager: LiveSubscriptionManager
    readonly lifecycle: Lifecycle
    readonly maxQueryBytes: number
    readonly maxPayloadBytes: number
    readonly idleTimeoutSeconds: number
}
