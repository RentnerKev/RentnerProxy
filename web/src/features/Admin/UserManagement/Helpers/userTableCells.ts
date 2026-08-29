export function formatUserCreatedAt(value: unknown, formatter: Intl.DateTimeFormat): string {
    const date = value instanceof Date ? value : new Date(String(value))

    return formatter.format(date)
}

export function getVisibleRoleKeys(roleKeys: readonly string[], limit = 2): Array<string> {
    return [...roleKeys].toSorted().slice(0, limit)
}
