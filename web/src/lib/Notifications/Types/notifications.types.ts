import type {
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_SEVERITIES,
} from '@/config/notifications.config.ts'

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export interface NotificationPayload {
    readonly schemaVersion: 1
    readonly id: string
    readonly incidentId: string
    readonly type: 'incident' | 'recovery' | 'test'
    readonly category: NotificationCategory
    readonly severity: NotificationSeverity | 'info'
    readonly resourceId: string
    readonly code:
        | 'certificate_renewal_failed'
        | 'ddns_update_failed'
        | 'proxy_apply_failed'
        | 'operation_recovered'
        | 'notification_test'
    readonly occurredAt: string
    readonly startedAt: string
    readonly failures: number
}

export interface NotificationChannelPolicy {
    readonly id: string
    readonly name: string
    readonly kind: 'email' | 'webhook'
    readonly revision: number
    readonly enabled: boolean
    readonly events: readonly NotificationCategory[]
    readonly minimumSeverity: NotificationSeverity
    readonly thresholdSeconds: number
    readonly recovery: boolean
}

export type NotificationDestination =
    | { readonly kind: 'email'; readonly recipients: readonly string[] }
    | {
          readonly kind: 'webhook'
          readonly url: string
          readonly authorizationToken: string | null
          readonly allowedPrivateCidrs: readonly string[]
      }

interface NotificationChannelSummary extends NotificationChannelPolicy {
    readonly destinationConfigured: boolean
    readonly hasAuthorization: boolean
}

export interface NotificationConfiguration {
    readonly version: 1
    readonly revision: number
    readonly enabled: boolean
    readonly pausedAfterRestore: boolean
    readonly channels: readonly NotificationChannelSummary[]
}

export interface PersonalNotificationSettings {
    readonly configuration: NotificationConfiguration
    readonly allowedCategories: readonly NotificationCategory[]
    readonly canUsePrivateDestinations: boolean
    readonly canResumeDelivery: boolean
    readonly smtpConfigured: boolean
}

export interface NotificationStatus {
    readonly incidents: readonly {
        readonly id: string
        readonly category: NotificationCategory
        readonly resourceId: string
        readonly severity: NotificationSeverity
        readonly startedAt: number
        readonly observedAt: number
        readonly failures: number
        readonly recoveredAt: number | null
    }[]
    readonly deliveries: readonly {
        readonly id: string
        readonly incidentId: string
        readonly channelId: string
        readonly channelRevision: number
        readonly type: NotificationPayload['type']
        readonly category: NotificationCategory
        readonly resourceId: string
        readonly status: 'pending' | 'inflight' | 'succeeded' | 'failed' | 'cancelled'
        readonly attempts: number
        readonly updatedAt: number
        readonly error: NotificationDeliveryError | null
    }[]
    readonly pendingCount: number
    readonly deferredCount: number
    readonly saturationCount: number
}

export interface NotificationObservation {
    readonly source: 'event' | 'snapshot'
    readonly category: NotificationCategory
    readonly resourceId: string
    readonly health: 'failing' | 'healthy' | 'pending'
    readonly desiredRevision?: string
    readonly severity: NotificationSeverity
    readonly occurredAt: string
    readonly evidence: string
    readonly failures: number
}

export type NotificationDeliveryError =
    | 'destination_blocked'
    | 'destination_unavailable'
    | 'redirect_denied'
    | 'http_rejected'
    | 'smtp_unavailable'
    | 'timeout'
    | 'cancelled'
    | 'payload_limit'
    | 'configuration_unavailable'

export type NotificationDeliveryResult =
    | { readonly success: true }
    | {
          readonly success: false
          readonly code: NotificationDeliveryError
          readonly retryable: boolean
          readonly retryAfterMs?: number
      }
