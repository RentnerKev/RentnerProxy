import type {
    CertificateErrorCode,
    CertificateOperationStage,
} from '../../../../config/Types/certificates-config.types.ts'
import type {
    AUDIT_ACTOR_KINDS,
    AUDIT_RESULTS,
    AUDIT_ACTIONS,
    AUDIT_RESOURCES,
    AUDIT_AUTHENTICATION_METHODS,
    AUDIT_FAILURE_CODES,
    AUDIT_CHANGED_FIELDS,
} from '@/config/audit.config.ts'

export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number]

export type AuditResult = (typeof AUDIT_RESULTS)[number]

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditResource = (typeof AUDIT_RESOURCES)[number]

export type AuditAuthenticationMethod = (typeof AUDIT_AUTHENTICATION_METHODS)[number]

export type AuditFailureCode = (typeof AUDIT_FAILURE_CODES)[number]

export type AuditChangedField = (typeof AUDIT_CHANGED_FIELDS)[number]

export interface AuditMetadata {
    readonly authenticationMethod?: AuditAuthenticationMethod
    readonly reason?: 'authentication_failed'
    readonly failureCode?: AuditFailureCode
    readonly changedFields?: readonly AuditChangedField[]
    readonly assigned?: boolean
    readonly previousId?: string | null
    readonly nextId?: string | null
    readonly runtimeStatus?: 'applied' | 'pending' | 'failed'
    readonly count?: number
    readonly operationId?: string
    readonly eventId?: string
    readonly certificateStage?: CertificateOperationStage
    readonly occurredAt?: string
    readonly certificateErrorCode?: CertificateErrorCode
}

export interface AuditEventInput {
    readonly actorUserId: string | null
    readonly actorKind: AuditActorKind
    readonly action: AuditAction
    readonly resource: AuditResource
    readonly targetId: string | null
    readonly result: AuditResult
    readonly metadata?: AuditMetadata
}

export interface AuditEventDto extends AuditEventInput {
    readonly id: string
    readonly timestamp: string
    readonly actorDisplayName: string | null
    readonly metadata: AuditMetadata
}

export interface AuditActorOption {
    readonly id: string
    readonly displayName: string
}

export interface AuditEventsQuery {
    readonly actorUserId?: string | undefined
    readonly action?: AuditAction | undefined
    readonly resource?: AuditResource | undefined
    readonly result?: AuditResult | undefined
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly cursor?: string | undefined
    readonly limit?: number | undefined
}

export interface AuditEventsResult {
    readonly events: readonly AuditEventDto[]
    readonly limit: number
    readonly nextCursor: string | null
    readonly hasMore: boolean
}
