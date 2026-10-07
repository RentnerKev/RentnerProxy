export class ImportResponseError extends Error {
    constructor(data: unknown, source: 'migration' | 'npmImport') {
        const code =
            data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
                ? data.error
                : ''
        const recognized = [
            'authentication_required',
            'permission_denied',
            'source_limit',
            'invalid_source',
            'unsupported_schema',
            'fingerprint_mismatch',
            'preview_changed',
            'import_failed',
            ...(source === 'npmImport' ? ['nothing_to_import'] : []),
        ].includes(code)
        super(recognized ? code : 'request_failed')
    }
}

export function getImportRequestErrorCode(error: unknown): string {
    return error instanceof ImportResponseError ? error.message : 'request_failed'
}
