import type {
    NotificationCategory,
    NotificationChannelPolicy,
    NotificationDeliveryError,
    NotificationPayload,
    NotificationSeverity,
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
    recoveredAt: number | null
    recoveryEvidence: string | null
    channels: NotificationIncidentChannel[]
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
