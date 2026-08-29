export function formatRoleCreatedAt(value: unknown, formatter: Intl.DateTimeFormat): string {
    const date = value instanceof Date ? value : new Date(String(value))

    return formatter.format(date)
}
