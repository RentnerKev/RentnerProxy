import { resolveCalendarMessages } from '@rentnerkev/calendar/messages'
import type { CalendarLocale, CalendarMessages } from '@rentnerkev/calendar/messages'

import type { AppLanguage, Translate } from '../../../language/useTranslationStore'

export function getCalendarLocale(language: AppLanguage): CalendarLocale {
    return language === 'de' ? 'de' : 'en'
}

function createMonthNames(locale: string): readonly string[] {
    const formatter = new Intl.DateTimeFormat(locale, {
        month: 'long',
        timeZone: 'UTC',
    })

    return Array.from({ length: 12 }, (_, month) =>
        formatter.format(new Date(Date.UTC(2026, month, 1))),
    )
}

export function createCalendarMessages(
    language: AppLanguage,
    locale: string,
    t: Translate,
): CalendarMessages {
    const defaults = resolveCalendarMessages(getCalendarLocale(language))

    return {
        ...defaults,
        placeholder: t('calendar.selectDate'),
        required: t('calendar.required'),
        apply: t('calendar.apply'),
        clear: t('calendar.clear'),
        openCalendar: t('calendar.open'),
        closeCalendar: t('calendar.close'),
        previousMonth: t('calendar.previousMonth'),
        nextMonth: t('calendar.nextMonth'),
        day: t('calendar.day'),
        range: t('calendar.rangeMode'),
        from: t('calendar.from'),
        to: t('calendar.to'),
        time: t('calendar.time'),
        month: t('calendar.month'),
        year: t('calendar.year'),
        searchOptions: t('calendar.searchOptions'),
        searchPlaceholder: t('calendar.searchPlaceholder'),
        noResults: t('calendar.noResults'),
        noOptions: t('calendar.noOptions'),
        selectDate: (date) => `${t('calendar.selectDate')}: ${date}`,
        weekdays: [
            t('calendar.weekdays.mon'),
            t('calendar.weekdays.tue'),
            t('calendar.weekdays.wed'),
            t('calendar.weekdays.thu'),
            t('calendar.weekdays.fri'),
            t('calendar.weekdays.sat'),
            t('calendar.weekdays.sun'),
        ],
        months: createMonthNames(locale),
    }
}
