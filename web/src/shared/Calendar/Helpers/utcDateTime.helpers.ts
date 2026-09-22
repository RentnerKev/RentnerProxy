import type { UtcDateTimeParts } from '../Types/utc-date-time.types'

const UTC_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u

export function parseUtcDateTimeValue(value: string): UtcDateTimeParts | undefined {
    const match = UTC_DATE_TIME_PATTERN.exec(value)
    if (!match) return undefined

    const date = match[1]!
    const time = `${match[2]}:${match[3]}`
    const parsed = new Date(`${date}T${time}:00.000Z`)

    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value
        ? { date, time }
        : undefined
}

export function createUtcDateTimeValue(date: string, time: string): string | undefined {
    return parseUtcDateTimeValue(`${date}T${time}`) ? `${date}T${time}` : undefined
}
