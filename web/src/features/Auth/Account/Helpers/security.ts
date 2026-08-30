export function formatSecurityTimestamp(value: string): string {
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return 'Unknown date'
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date)
}
