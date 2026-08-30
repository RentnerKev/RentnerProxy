import * as Popover from 'radix-ui/popover'

import useTranslationStore from '../../language/useTranslationStore'
import CalendarPopoverContent from './Components/CalendarPopoverContent'
import CalendarTrigger from './Components/CalendarTrigger'
import useDateRangeCalendarLogic from './Hooks/useDateRangeCalendarLogic'
import type { DateRangeCalendarProps } from './Types/date-range-calendar.types'

export default function DateRangeCalendar({
    ariaLabel,
    className,
    fromLabel,
    onValueChange,
    toLabel,
    value,
}: DateRangeCalendarProps) {
    const { t } = useTranslationStore()
    const { contentRef, state, handler } = useDateRangeCalendarLogic({ onValueChange, value })
    const resolvedFromLabel = fromLabel ?? t('calendar.from')
    const resolvedToLabel = toLabel ?? t('calendar.to')

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
                fromLabel={resolvedFromLabel}
                handler={handler}
                state={state}
                toLabel={resolvedToLabel}
            />
        </Popover.Root>
    )
}

export type { DateRangeCalendarProps, DateRangeValue } from './Types/date-range-calendar.types'
