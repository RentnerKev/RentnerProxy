import type {
    NotificationCategory,
    NotificationChannelPolicy,
    NotificationDeliveryError,
    NotificationPayload,
    NotificationSeverity,
    HostAvailabilityNotification,
} from '@/lib/Notifications/Types/notifications.types.ts'

export interface NotificationEngineConfiguration {
    readonly enabled: boolean
    readonly pausedAfterRestore: boolean
    readonly channels: readonly NotificationChannelPolicy[]
}

type NotificationDeliveryStatus = 'pending' | 'inflight' | 'succeeded' | 'failed' | 'cancelled'
type NotificationAdmissionStatus = 'pending' | 'succeeded' | 'failed'

interface NotificationIncidentChannel {
    channelId: string
    channelRevision: number
    failure: NotificationAdmissionStatus
    recovery: NotificationAdmissionStatus | null
}

export interface NotificationIncident {
    id: string
    category: NotificationCategory
    resourceId: string
    severity: NotificationSeverity
    startedAt: number
    observedAt: number
    evidence: string
    failures: number
    code?: 'certificate_renewal_manual_dns_required' | undefined
    recoveredAt: number | null
    recoveryEvidence: string | null
    channels: NotificationIncidentChannel[]
    host?: HostAvailabilityNotificationContext | undefined
}

export interface HostAvailabilityNotificationContext extends HostAvailabilityNotification {
    readonly policyId: string
    readonly policyVersion: string
    readonly contextProof: string
    readonly contextRevision: string
    readonly subscriptions?:
        | readonly {
              readonly channelId: string
              readonly channelRevision: number
          }[]
        | undefined
}

export interface HostAvailabilityNotificationTransition {
    readonly kind: 'outage' | 'recovery'
    readonly incidentId: string
    readonly proxyHostId: string
    readonly startedAt: number
    readonly occurredAt: number
    readonly failures: number
    readonly host: HostAvailabilityNotificationContext
}

export interface NotificationQueuedDelivery {
    id: string
    channelId: string
    channelRevision: number
    payload: NotificationPayload
    status: NotificationDeliveryStatus
    attempts: number
    createdAt: number
    updatedAt: number
    nextAttemptAt: number
    leaseToken: string | null
    leaseExpiresAt: number | null
    error: NotificationDeliveryError | null
}

export interface NotificationState {
    version: 1
    proxyApplyPending: { desiredRevision: string; since: number; observedAt: number } | null
    incidents: NotificationIncident[]
    deliveries: NotificationQueuedDelivery[]
    deferredCount: number
    saturationCount: number
}

export interface NotificationClaimedDelivery {
    id: string
    channelId: string
    channelRevision: number
    payload: NotificationPayload
    leaseToken: string
}
