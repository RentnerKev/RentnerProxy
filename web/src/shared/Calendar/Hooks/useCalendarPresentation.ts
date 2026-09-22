import { useMemo } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import { createCalendarMessages, getCalendarLocale } from '../Helpers/calendarLocalization.helpers'
import type { CalendarPresentation } from '../Types/calendar-presentation.types'

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
