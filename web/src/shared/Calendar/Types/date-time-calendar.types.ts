import type { RefObject } from 'react'

import type { CalendarDayViewModel } from './date-range-calendar.types'

export interface DateTimeOption {
    readonly label: string
    readonly value: string
}

export interface DateTimeCalendarProps {
    readonly ariaLabel: string
    readonly describedBy?: string | undefined
    readonly disabled?: boolean | undefined
    readonly invalid?: boolean | undefined
    readonly onValueChange: (value: string) => void
    readonly value: string
}

export interface DateTimeCalendarState {
    readonly dateLabel: string
    readonly dateValue: string
    readonly focusedDateValue: string
    readonly hour: string
    readonly hours: ReadonlyArray<DateTimeOption>
    readonly minute: string
    readonly minutes: ReadonlyArray<DateTimeOption>
    readonly monthLabel: string
    readonly open: boolean
    readonly timeLabel: string
    readonly triggerLabel: string
    readonly weeks: ReadonlyArray<ReadonlyArray<CalendarDayViewModel>>
}

export interface DateTimeCalendarLogic {
    readonly contentRef: RefObject<HTMLDivElement | null>
    readonly handler: {
        readonly clear: () => void
        readonly handleDayFocus: (dateValue: string) => void
        readonly handleDayKeyDown: import('./date-range-calendar.types').DateRangeCalendarHandler['handleDayKeyDown']
        readonly handleHourChange: (hour: string) => void
        readonly handleMinuteChange: (minute: string) => void
        readonly handleOpenAutoFocus: (event: Event) => void
        readonly handleOpenChange: (open: boolean) => void
        readonly handleSelectDate: (dateValue: string) => void
        readonly showNextMonth: () => void
        readonly showPreviousMonth: () => void
    }
    readonly state: DateTimeCalendarState
}
