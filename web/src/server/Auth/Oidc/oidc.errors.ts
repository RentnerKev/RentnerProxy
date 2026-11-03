import type { OidcFeedbackCode } from '@/lib/Auth/Oidc/Types/oidc-feedback.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

export type OidcErrorCode =
    | 'invalid_input'
    | 'configuration_conflict'
    | 'configuration_unavailable'
    | 'provider_unavailable'
    | 'authentication_failed'
    | 'identity_not_allowed'
    | 'challenge_expired'
    | 'authentication_required'

const feedbackCodes: Record<OidcErrorCode, OidcFeedbackCode> = {
    invalid_input: 'failed',
    configuration_conflict: 'conflict',
    configuration_unavailable: 'unavailable',
    provider_unavailable: 'unavailable',
    authentication_failed: 'failed',
    identity_not_allowed: 'denied',
    challenge_expired: 'expired',
    authentication_required: 'failed',
}

/** Carries an allowlisted error code without protocol payloads or credentials. */
export class OidcDomainError extends Error {
    constructor(readonly code: OidcErrorCode) {
        super(code)
        this.name = 'OidcDomainError'
    }
}

/** Keeps only recognized server error codes; provider messages and arbitrary error shapes are discarded. */
export function normalizeOidcFlowError(error: unknown): OidcDomainError {
    if (error instanceof OidcDomainError && Object.hasOwn(feedbackCodes, error.code))
        return new OidcDomainError(error.code)
    if (error instanceof AuthDomainError) {
        switch (error.code) {
            case 'authentication_required':
                return new OidcDomainError(error.code)
            case 'permission_denied':
            case 'owner_required':
            case 'user_not_active':
                return new OidcDomainError('identity_not_allowed')
            case 'service_unavailable':
                return new OidcDomainError('configuration_unavailable')
        }
    }
    return new OidcDomainError('authentication_failed')
}

/** Supplies a fixed public category, never an error's text, payload, URL or subject. */
export function getOidcFeedbackCode(error: unknown): OidcFeedbackCode {
    return feedbackCodes[normalizeOidcFlowError(error).code]
}
