import type { NotificationChannelPolicy } from '@/lib/Notifications/Types/notifications.types.ts'
import type { NotificationState, NotificationClaimedDelivery } from './notification-state.types.ts'
import type { MailAppearance } from '@/server/Mail/Types/mail-theme.types.ts'
import type { HostMonitoringOutcomeCode } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'

export interface HostAvailabilityIncidentSource {
    readonly id: string
    readonly startedAt: Date
    readonly detectedAt: Date
    readonly recoveryStartedAt: Date | null
    readonly recoveredAt: Date | null
    readonly failureCode: HostMonitoringOutcomeCode
}

export interface EncryptedNotificationDestination {
    readonly ciphertext: string
    readonly iv: string
}

export interface StoredNotificationChannel extends NotificationChannelPolicy {
    readonly ownerUserId?: string | undefined
    readonly destination: EncryptedNotificationDestination
    readonly hasAuthorization: boolean
}

export interface StoredNotificationConfiguration {
    readonly version: 1
    readonly revision: number
    readonly enabled: boolean
    readonly pausedAfterRestore: boolean
    readonly channels: readonly StoredNotificationChannel[]
}

export interface NotificationRuntime {
    readonly version: 1
    engine: NotificationState
    certificateCursor: string | null
    collectionLease: { readonly token: string; readonly expiresAt: number } | null
}

export interface NotificationCollectionClaim {
    readonly token: string
    readonly configurationRevision: number
    readonly certificateCursor: string | null
}

export interface NotificationDeliveryClaim extends NotificationClaimedDelivery {
    readonly channel: StoredNotificationChannel
}

export interface NotificationDeliveryAuthorization {
    readonly channel: StoredNotificationChannel
    readonly allowPrivateDestinations: boolean
    readonly mailAppearance?: MailAppearance | undefined
}
