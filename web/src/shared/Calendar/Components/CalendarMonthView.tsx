import { ChevronLeft, ChevronRight } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import CalendarMonthGrid from './CalendarMonthGrid'
import type { CalendarMonthViewProps } from '../Types/date-range-calendar.types'

export default function CalendarMonthView({
    focusedDateValue,
    monthLabel,
    onDayFocus,
    onDayKeyDown,
    onNextMonth,
    onPreviousMonth,
    onSelectDate,
    weeks,
}: CalendarMonthViewProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <button
                    type="button"
                    aria-label={t('calendar.previousMonth')}
                    onClick={onPreviousMonth}
                    className="grid size-12 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                    <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
                <h3 className="text-sm font-extrabold text-ink-soft" aria-live="polite">
                    {monthLabel}
                </h3>
                <button
                    type="button"
                    aria-label={t('calendar.nextMonth')}
                    onClick={onNextMonth}
                    className="grid size-12 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                    <ChevronRight aria-hidden="true" className="size-4" />
                </button>
            </div>
            <CalendarMonthGrid
                focusedDateValue={focusedDateValue}
                weeks={weeks}
                onDayFocus={onDayFocus}
                onDayKeyDown={onDayKeyDown}
                onSelectDate={onSelectDate}
            />
        </>
    )
}
