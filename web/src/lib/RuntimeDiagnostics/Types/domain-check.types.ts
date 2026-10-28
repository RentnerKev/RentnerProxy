import type { DomainDiagnosticsResult } from './domain-diagnostics.types.ts'

export type DomainCheckErrorCode =
    | 'invalid_input'
    | 'permission_denied'
    | 'authentication_required'
    | 'configuration_changed'
    | 'rate_limited'
    | 'busy'
    | 'runtime_unavailable'
    | 'invalid_response'
    | 'request_failed'
    | 'timeout'

export type DomainCheckStageName = keyof DomainDiagnosticsResult['stages']
