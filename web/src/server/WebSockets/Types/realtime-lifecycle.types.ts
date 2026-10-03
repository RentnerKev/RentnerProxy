import type { LiveSubscriptionManager } from './realtime-subscriptions.types.ts'

import type { LiveConnectionData } from './realtime-subscriptions.types.ts'

export interface RealtimeLifecycleOptions {
    readonly manager: LiveSubscriptionManager
    readonly pending: Set<LiveConnectionData>
}
