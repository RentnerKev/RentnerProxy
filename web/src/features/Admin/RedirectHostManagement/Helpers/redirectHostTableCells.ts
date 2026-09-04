export function formatRedirectHostCreatedAt(
    value: unknown,
    formatter: Intl.DateTimeFormat,
): string {
    const date = value instanceof Date ? value : new Date(String(value))
    return Number.isNaN(date.getTime()) ? '—' : formatter.format(date)
}
