import type {
    CertificateErrorCode,
    CertificateOperationStage,
} from '../../config/certificates.config'

export const AUDIT_ACTOR_KINDS = ['user', 'anonymous', 'system'] as const
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number]

export const AUDIT_RESULTS = ['success', 'failure', 'denied'] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

/** Stable actions shared by user mutations and observed system operations. */
export const AUDIT_ACTIONS = [
    'login',
    'logout',
    'create',
    'update',
    'delete',
    'enable',
    'disable',
    'rotate',
    'reset',
    'accept',
    'reauthenticate',
    'import',
    'replace',
    'request',
    'renew',
    'save',
    'apply',
    'accepted',
    'started',
    'issued',
    'activated',
    'renewed',
    'retry_scheduled',
    'failed',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_RESOURCES = [
    'session',
    'password',
    'totp',
    'recovery-codes',
    'passkey',
    'invite',
    'setup',
    'security-settings',
    'user',
    'role',
    'proxy-host',
    'redirect-host',
    'access-policy',
    'basic-auth-account',
    'certificate',
    'trusted-ca',
    'proxy-runtime-settings',
    'proxy-host-settings',
    'proxy-runtime',
] as const
export type AuditResource = (typeof AUDIT_RESOURCES)[number]

export const AUDIT_AUTHENTICATION_METHODS = [
    'password',
    'totp',
    'recovery-code',
    'passkey',
    'invite',
    'setup',
] as const
export type AuditAuthenticationMethod = (typeof AUDIT_AUTHENTICATION_METHODS)[number]

export const AUDIT_FAILURE_CODES = [
    'authentication_failed',
    'permission_denied',
    'invalid_input',
    'not_found',
    'conflict',
    'reauthentication_required',
    'service_unavailable',
    'challenge_expired',
    'invalid_or_expired_token',
    'runtime_pending',
    'runtime_failed',
] as const
export type AuditFailureCode = (typeof AUDIT_FAILURE_CODES)[number]

export const AUDIT_CHANGED_FIELDS = [
    'displayName',
    'email',
    'status',
    'roles',
    'permissions',
    'name',
    'description',
    'mode',
    'combination',
    'ipRules',
    'basicAuth',
    'domains',
    'upstream',
    'tls',
    'headers',
    'certificate',
    'trustedCa',
    'accessPolicy',
    'security',
] as const
export type AuditChangedField = (typeof AUDIT_CHANGED_FIELDS)[number]

/** Values safe to persist in the audit trail. Never pass request or credential data here. */
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
