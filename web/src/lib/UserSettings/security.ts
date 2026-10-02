export function formatSecurityTimestamp(value: string, locale: string): string | null {
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return null
    }

    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'long',
        timeZone: 'UTC',
    }).format(date)
}

export function getPasskeyRegistrationErrorKey(error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null

    if (code === 'ERROR_INVALID_DOMAIN') return 'account.passkeys.error.invalidDomain'
    if (code === 'ERROR_INVALID_RP_ID') return 'account.passkeys.error.invalidRpId'

    return 'account.passkeys.error.registrationFailed'
}
