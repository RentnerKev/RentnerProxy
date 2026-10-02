import { useMemo } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createCalendarMessages, getCalendarLocale } from '@/lib/Calendar/calendarLocalization.ts'
import type { CalendarPresentation } from '../Types/calendar-presentation.types.ts'

export default function useCalendarPresentation(): CalendarPresentation {
    const { language, locale, t } = useTranslationStore()
    const messages = useMemo(
        () => createCalendarMessages(language, locale, t),
        [language, locale, t],
    )

    return {
        locale: getCalendarLocale(language),
        messages,
        t,
    }
}
