export function formatAccessPolicyCreatedAt(
    value: unknown,
    formatter: Intl.DateTimeFormat,
): string {
    if (value instanceof Date) return formatter.format(value)
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? '—' : formatter.format(parsed)
}
