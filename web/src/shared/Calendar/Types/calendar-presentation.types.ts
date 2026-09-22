import type { CalendarLocale, CalendarMessages } from '@rentnerkev/calendar/messages'

import type { Translate } from '../../../language/useTranslationStore'

export interface CalendarPresentation {
    readonly locale: CalendarLocale
    readonly messages: CalendarMessages
    readonly t: Translate
}
