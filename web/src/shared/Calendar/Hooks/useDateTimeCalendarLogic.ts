import { useMemo } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import useDateRangeCalendarLogic from './useDateRangeCalendarLogic'
import {
    createTimeOptions,
    formatDateTimeLabel,
    formatDateTimeValue,
    getDateTimeDate,
    getDateTimeHour,
    getDateTimeMinute,
} from '../Helpers/dateTimeCalendar.helpers'
import { parseDateValue } from '../Helpers/dateRangeCalendar.helpers'
import type {
    DateTimeCalendarLogic,
    DateTimeCalendarProps,
} from '../Types/date-time-calendar.types'

export default function useDateTimeCalendarLogic({
    onValueChange,
    value,
}: Pick<DateTimeCalendarProps, 'onValueChange' | 'value'>): DateTimeCalendarLogic {
    const { locale, t } = useTranslationStore()
    const rawDateValue = getDateTimeDate(value)
    const dateValue = parseDateValue(rawDateValue) ? rawDateValue : ''
    const hour = dateValue ? getDateTimeHour(value) || '00' : ''
    const minute = dateValue ? getDateTimeMinute(value) || '00' : ''
    const rangeLogic = useDateRangeCalendarLogic({
        closeOnSelect: false,
        onValueChange: (nextValue) => {
            const from = nextValue?.from
            if (!from) return
            onValueChange(formatDateTimeValue(from, hour || '00', minute || '00'))
        },
        selectionMode: 'single',
        value: { from: dateValue },
    })
    const labels = useMemo(() => formatDateTimeLabel(value, locale, t), [locale, t, value])
    const hours = useMemo(() => createTimeOptions(24), [])
    const minutes = useMemo(() => createTimeOptions(60), [])
    const updateTime = (nextHour: string, nextMinute: string) => {
        if (!dateValue) return
        onValueChange(formatDateTimeValue(dateValue, nextHour, nextMinute))
    }

    return {
        contentRef: rangeLogic.contentRef,
        handler: {
            clear: () => onValueChange(''),
            handleDayFocus: rangeLogic.handler.handleDayFocus,
            handleDayKeyDown: rangeLogic.handler.handleDayKeyDown,
            handleHourChange: (nextHour) => updateTime(nextHour, minute),
            handleMinuteChange: (nextMinute) => updateTime(hour, nextMinute),
            handleOpenAutoFocus: rangeLogic.handler.handleOpenAutoFocus,
            handleOpenChange: rangeLogic.handler.handleOpenChange,
            handleSelectDate: rangeLogic.handler.handleSelectDate,
            showNextMonth: rangeLogic.handler.showNextMonth,
            showPreviousMonth: rangeLogic.handler.showPreviousMonth,
        },
        state: {
            dateLabel: labels.date,
            dateValue,
            focusedDateValue: rangeLogic.state.focusedDateValue,
            hour,
            hours,
            minute,
            minutes,
            monthLabel: rangeLogic.state.monthLabel,
            open: rangeLogic.state.open,
            timeLabel: labels.time,
            triggerLabel: labels.trigger,
            weeks: rangeLogic.state.weeks,
        },
    }
}
