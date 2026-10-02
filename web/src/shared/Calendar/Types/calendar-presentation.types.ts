import type { CalendarLocale, CalendarMessages } from '@rentnerkev/calendar/messages'

import type { Translate } from '@/shared/Language/Types/language.types.ts'

export interface CalendarPresentation {
    readonly locale: CalendarLocale
    readonly messages: CalendarMessages
    readonly t: Translate
}
