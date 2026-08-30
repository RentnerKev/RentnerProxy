export function formatProxyHostForward(
    forwardScheme: 'http' | 'https',
    forwardHost: string,
    forwardPort: number,
): string {
    const host = forwardHost.trim()
    const displayHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

    return `${forwardScheme}://${displayHost}:${forwardPort}`
}

export function formatProxyHostCreatedAt(value: unknown, formatter: Intl.DateTimeFormat): string {
    const date = value instanceof Date ? value : new Date(String(value))

    return Number.isNaN(date.getTime()) ? '—' : formatter.format(date)
}
