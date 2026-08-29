import type { ComponentPropsWithRef, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

export interface DateRangeValue {
    readonly from?: string | undefined
    readonly to?: string | undefined
}

export interface DateRangeCalendarProps {
    readonly ariaLabel: string
    readonly className?: string | undefined
    readonly fromLabel?: string | undefined
    readonly onValueChange: (value: DateRangeValue | undefined) => void
    readonly toLabel?: string | undefined
    readonly value: DateRangeValue
}

export interface CalendarDayViewModel {
    readonly dateValue: string
    readonly dayNumber: number
    readonly fullDateLabel: string
    readonly isCurrentMonth: boolean
    readonly isInRange: boolean
    readonly isRangeEnd: boolean
    readonly isRangeStart: boolean
    readonly isToday: boolean
}

export interface DateRangeCalendarState {
    readonly focusedDateValue: string
    readonly fromDateLabel: string
    readonly hasFrom: boolean
    readonly hasTo: boolean
    readonly hint: string
    readonly monthLabel: string
    readonly open: boolean
    readonly rangeLabel: string
    readonly toDateLabel: string
    readonly weeks: ReadonlyArray<ReadonlyArray<CalendarDayViewModel>>
}

export interface DateRangeCalendarLogic {
    readonly contentRef: RefObject<HTMLDivElement | null>
    readonly handler: DateRangeCalendarHandler
    readonly state: DateRangeCalendarState
}

export interface DateRangeCalendarHandler {
    readonly clear: () => void
    readonly handleDayFocus: (dateValue: string) => void
    readonly handleDayKeyDown: (
        event: ReactKeyboardEvent<HTMLButtonElement>,
        dateValue: string,
    ) => void
    readonly handleOpenAutoFocus: (event: Event) => void
    readonly handleOpenChange: (open: boolean) => void
    readonly handleSelectDate: (dateValue: string) => void
    readonly showNextMonth: () => void
    readonly showPreviousMonth: () => void
}

export interface CalendarTriggerProps extends Omit<
    ComponentPropsWithRef<'button'>,
    'aria-label' | 'children'
> {
    readonly ariaLabel: string
    readonly hasValue: boolean
    readonly rangeLabel: string
}

export interface CalendarPopoverContentProps {
    readonly ariaLabel: string
    readonly contentRef: RefObject<HTMLDivElement | null>
    readonly fromLabel: string
    readonly handler: DateRangeCalendarHandler
    readonly state: DateRangeCalendarState
    readonly toLabel: string
}

export interface CalendarMonthGridProps {
    readonly focusedDateValue: string
    readonly onDayFocus: (dateValue: string) => void
    readonly onDayKeyDown: DateRangeCalendarHandler['handleDayKeyDown']
    readonly onSelectDate: (dateValue: string) => void
    readonly weeks: DateRangeCalendarState['weeks']
}
