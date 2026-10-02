import {
    CERTIFICATE_ERROR_CODES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_STORED_STATUSES,
} from '../../web/src/config/certificates.config.ts'

function allowed(field: unknown, values: readonly string[]) {
    return values.find((entry) => entry === field) ?? 'unexpected'
}

export function certificateFailureDetails(value: unknown, observedStages: readonly string[]) {
    const record =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}
    const current =
        record.currentOperation && typeof record.currentOperation === 'object'
            ? (record.currentOperation as Record<string, unknown>)
            : {}
    return {
        status: allowed(record.status, CERTIFICATE_STORED_STATUSES),
        operation: allowed(record.operation, CERTIFICATE_OPERATIONS),
        errorCode:
            record.lastErrorCode === null
                ? null
                : allowed(record.lastErrorCode, CERTIFICATE_ERROR_CODES),
        stage: allowed(current.stage, CERTIFICATE_OPERATION_STAGES),
        candidatePresent: record.candidate !== null && record.candidate !== undefined,
        fingerprintPresent:
            typeof record.fingerprint === 'string' &&
            /^sha256:[a-f0-9]{64}$/u.test(record.fingerprint),
        observedStages: observedStages
            .slice(0, 32)
            .map((stage) => allowed(stage, CERTIFICATE_OPERATION_STAGES)),
    }
}

export function pebbleFailureCategories(log: string): string[] {
    return [
        'incorrectResponse',
        'unauthorized',
        'connection',
        'dns',
        'tls',
        'rateLimited',
        'badNonce',
        'serverInternal',
        'malformed',
    ].filter((code) => log.includes('urn:ietf:params:acme:error:' + code))
}
