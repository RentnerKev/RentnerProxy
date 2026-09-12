import type { Translate } from '../../../language/useTranslationStore'
import { createCalendarFormatters, parseDateValue } from './dateRangeCalendar.helpers'

export function getDateTimeDate(value: string): string {
    return value.slice(0, 10)
}

export function getDateTimeHour(value: string): string {
    return value.slice(11, 13)
}

export function getDateTimeMinute(value: string): string {
    return value.slice(14, 16)
}

export function formatDateTimeValue(dateValue: string, hour: string, minute: string): string {
    return `${dateValue}T${hour}:${minute}`
}

export function formatDateTimeLabel(
    value: string,
    locale: string,
    t: Translate,
): { readonly date: string; readonly time: string; readonly trigger: string } {
    const dateValue = getDateTimeDate(value)
    const date = parseDateValue(dateValue)
    if (!date) {
        const empty = t('calendar.selectDate')
        return { date: empty, time: '', trigger: empty }
    }

    const hour = getDateTimeHour(value) || '00'
    const minute = getDateTimeMinute(value) || '00'
    const formatters = createCalendarFormatters(locale)
    const time = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute))))
    return {
        date: formatters.shortDate.format(date),
        time,
        trigger: `${formatters.shortDate.format(date)} · ${time}`,
    }
}

export function createTimeOptions(
    max: number,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
    return Array.from({ length: max }, (_, index) => {
        const value = String(index).padStart(2, '0')
        return { label: value, value }
    })
}
