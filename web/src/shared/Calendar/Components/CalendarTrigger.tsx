import { CalendarDays } from 'lucide-react'
import { forwardRef } from 'react'

import type { CalendarTriggerProps } from '../Types/date-range-calendar.types'

const CalendarTrigger = forwardRef<HTMLButtonElement, CalendarTriggerProps>(
    function CalendarTrigger({ ariaLabel, className, hasValue, rangeLabel, ...buttonProps }, ref) {
        return (
            <button
                {...buttonProps}
                ref={ref}
                type="button"
                aria-label={`${ariaLabel}: ${rangeLabel}`}
                className={`group inline-flex h-9 w-full min-w-44 items-center justify-between gap-2 rounded-lg border border-input-border bg-surface-raised px-2.5 text-left text-xs font-bold text-ink outline-hidden transition-[border-color,box-shadow,background-color] hover:border-border-strong focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/15 motion-reduce:transition-none ${className ?? ''}`}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className="text-muted transition-colors group-data-[state=open]:text-brand-text">
                        <CalendarDays
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.7}
                        />
                    </span>
                    <span className={`truncate ${hasValue ? 'text-ink' : 'text-muted-soft'}`}>
                        {rangeLabel}
                    </span>
                </span>
                <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-brand-500 opacity-0 shadow-[0_0_0_3px_rgb(48_238_97_/_14%)] transition-opacity group-data-[state=open]:opacity-100"
                />
            </button>
        )
    },
)

export default CalendarTrigger
