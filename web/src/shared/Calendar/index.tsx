import * as Popover from 'radix-ui/popover'

import CalendarPopoverContent from './Components/CalendarPopoverContent'
import CalendarTrigger from './Components/CalendarTrigger'
import useDateRangeCalendarLogic from './Hooks/useDateRangeCalendarLogic'
import type { DateRangeCalendarProps } from './Types/date-range-calendar.types'

export default function DateRangeCalendar({
    ariaLabel,
    className,
    fromLabel = 'From',
    onValueChange,
    toLabel = 'To',
    value,
}: DateRangeCalendarProps) {
    const { contentRef, state, handler } = useDateRangeCalendarLogic({ onValueChange, value })

    return (
        <Popover.Root open={state.open} onOpenChange={handler.handleOpenChange}>
            <Popover.Trigger asChild>
                <CalendarTrigger
                    ariaLabel={ariaLabel}
                    className={className}
                    hasValue={state.hasFrom}
                    rangeLabel={state.rangeLabel}
                />
            </Popover.Trigger>
            <CalendarPopoverContent
                ariaLabel={ariaLabel}
                contentRef={contentRef}
                fromLabel={fromLabel}
                handler={handler}
                state={state}
                toLabel={toLabel}
            />
        </Popover.Root>
    )
}

export type { DateRangeCalendarProps, DateRangeValue } from './Types/date-range-calendar.types'
