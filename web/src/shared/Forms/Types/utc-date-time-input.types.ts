import type { SingleCalendarValue } from '@rentnerkev/calendar/types'

import type { CalendarPresentation } from '../../Calendar/Types/calendar-presentation.types'

export interface UtcDateTimeInputProps {
    readonly ariaLabel: string
    readonly describedBy?: string | undefined
    readonly disabled?: boolean | undefined
    readonly invalid?: boolean | undefined
    readonly onValueChange: (value: string) => void
    readonly value: string
}

export interface UtcDateTimeInputLogic {
    readonly state: {
        readonly date: string | undefined
        readonly hasValue: boolean
        readonly presentation: CalendarPresentation
        readonly time: string
    }
    readonly handler: {
        readonly handleDateChange: (date: SingleCalendarValue) => void
        readonly handleTimeChange: (time: string) => void
    }
}
