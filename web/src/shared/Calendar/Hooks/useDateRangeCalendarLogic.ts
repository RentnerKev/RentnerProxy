import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import {
    addMonths,
    createCalendarFormatters,
    createCalendarWeeks,
    createSelectedRange,
    formatDateValue,
    formatMonth,
    formatShortDate,
    getInitialMonth,
    getKeyboardTargetDate,
    getRangeLabel,
    getToday,
    parseDateValue,
    startOfMonth,
} from '../Helpers/dateRangeCalendar.helpers'
import type {
    DateRangeCalendarLogic,
    DateRangeCalendarProps,
} from '../Types/date-range-calendar.types'

type DateRangeCalendarLogicParams = Pick<DateRangeCalendarProps, 'onValueChange' | 'value'>

export default function useDateRangeCalendarLogic({
    onValueChange,
    value,
}: DateRangeCalendarLogicParams): DateRangeCalendarLogic {
    const { locale, t } = useTranslationStore()
    const [open, setOpen] = useState(false)
    const [visibleMonth, setVisibleMonth] = useState(() => getInitialMonth(value))
    const [focusedDateValue, setFocusedDateValue] = useState(
        () => value.from ?? formatDateValue(getToday()),
    )
    const contentRef = useRef<HTMLDivElement | null>(null)
    const from = parseDateValue(value.from)
    const to = parseDateValue(value.to)
    const formatters = useMemo(() => createCalendarFormatters(locale), [locale])

    const focusCalendarDate = (date: Date) => {
        const nextDateValue = formatDateValue(date)
        setFocusedDateValue(nextDateValue)

        if (
            date.getMonth() !== visibleMonth.getMonth() ||
            date.getFullYear() !== visibleMonth.getFullYear()
        ) {
            setVisibleMonth(startOfMonth(date))
        }

        window.requestAnimationFrame(() => {
            contentRef.current
                ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${nextDateValue}"]`)
                ?.focus()
        })
    }

    const handleDayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, dateValue: string) => {
        const date = parseDateValue(dateValue)
        const nextDate = date ? getKeyboardTargetDate(date, event.key) : null

        if (nextDate) {
            event.preventDefault()
            focusCalendarDate(nextDate)
        }
    }

    const handleSelectDate = (dateValue: string) => {
        const selectedDate = parseDateValue(dateValue)

        if (!selectedDate) {
            return
        }

        const selection = createSelectedRange(selectedDate, from, to)
        onValueChange(selection.value)
        setFocusedDateValue(dateValue)

        if (selection.completed) {
            setOpen(false)
        }
    }

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            const initialDate = parseDateValue(value.from) ?? getToday()
            setVisibleMonth(startOfMonth(initialDate))
            setFocusedDateValue(formatDateValue(initialDate))
        }

        setOpen(nextOpen)
    }

    const handleOpenAutoFocus = (event: Event) => {
        event.preventDefault()
        window.requestAnimationFrame(() => {
            contentRef.current
                ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusedDateValue}"]`)
                ?.focus()
        })
    }

    return {
        contentRef,
        state: {
            focusedDateValue,
            fromDateLabel: formatShortDate(from, formatters, t),
            hasFrom: Boolean(from),
            hasTo: Boolean(to),
            hint: from && !to ? t('calendar.hint.end') : t('calendar.hint.start'),
            monthLabel: formatMonth(visibleMonth, formatters),
            open,
            rangeLabel: getRangeLabel(value, formatters, t),
            toDateLabel: formatShortDate(to, formatters, t),
            weeks: createCalendarWeeks(visibleMonth, from, to, getToday(), formatters),
        },
        handler: {
            clear: () => onValueChange(undefined),
            handleDayFocus: setFocusedDateValue,
            handleDayKeyDown,
            handleOpenAutoFocus,
            handleOpenChange,
            handleSelectDate,
            showNextMonth: () => setVisibleMonth((month) => addMonths(month, 1)),
            showPreviousMonth: () => setVisibleMonth((month) => addMonths(month, -1)),
        },
    }
}
