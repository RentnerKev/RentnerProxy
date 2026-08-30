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
