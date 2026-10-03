export class DefaultSiteError extends Error {
    constructor(readonly code: 'configuration_conflict') {
        super(code)
    }
}

export class DefaultSiteHtmlFormatError extends Error {
    constructor() {
        super('HTML could not be formatted.')
    }
}
