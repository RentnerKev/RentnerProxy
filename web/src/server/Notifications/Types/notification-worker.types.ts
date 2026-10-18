import type {
    NotificationDeliveryResult,
    NotificationObservation,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    NotificationCollectionClaim,
    NotificationDeliveryClaim,
} from './notification-internal.types.ts'

export interface NotificationCollectedBatch {
    readonly observations: readonly NotificationObservation[]
    readonly certificateCursor: string | null
}

export interface NotificationWorkerDependencies {
    readonly claimCollection: () => Promise<NotificationCollectionClaim | null>
    readonly collect: (
        cursor: string | null,
        signal: AbortSignal,
    ) => Promise<NotificationCollectedBatch>
    readonly commitCollection: (
        claim: NotificationCollectionClaim,
        batch: NotificationCollectedBatch,
    ) => Promise<boolean>
    readonly claimDelivery: () => Promise<NotificationDeliveryClaim | null>
    readonly deliver: (
        claim: NotificationDeliveryClaim,
        signal: AbortSignal,
    ) => Promise<NotificationDeliveryResult>
    readonly acknowledge: (leaseToken: string, result: NotificationDeliveryResult) => Promise<void>
    readonly changed: () => void
    readonly unavailable: () => void
}
