export function formatBackupDate(timestamp: number | null | undefined, locale: string) {
    if (timestamp === null || timestamp === undefined) return '—'
    const date = new Date(timestamp)
    return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
        : '—'
}

export function formatBackupBytes(bytes: number, locale: string) {
    const units = ['B', 'KiB', 'MiB', 'GiB']
    const index = Math.min(Math.floor(Math.log2(Math.max(1, bytes)) / 10), units.length - 1)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`
}

export function formatBackupDuration(durationMs: number | null, locale: string) {
    if (durationMs === null) return '—'
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: durationMs < 60_000 ? 'second' : 'minute',
        unitDisplay: 'short',
        maximumFractionDigits: 1,
    }).format(durationMs / (durationMs < 60_000 ? 1_000 : 60_000))
}
