export class DefaultSiteError extends Error {
    constructor(readonly code: 'configuration_conflict') {
        super(code)
    }
}
