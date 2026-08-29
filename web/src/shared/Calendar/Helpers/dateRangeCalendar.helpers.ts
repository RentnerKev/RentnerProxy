import type { CalendarDayViewModel, DateRangeValue } from '../Types/date-range-calendar.types'

export const calendarWeekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const monthFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' })
const shortDateFormatter = new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
})
const fullDateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'full' })

export function createLocalDate(year: number, month: number, day: number): Date {
    return new Date(year, month, day, 12)
}

export function getToday(): Date {
    const now = new Date()

    return createLocalDate(now.getFullYear(), now.getMonth(), now.getDate())
}

export function parseDateValue(value: string | undefined): Date | null {
    if (!value) {
        return null
    }

    const parts = value.split('-').map(Number)
    const year = parts.at(0)
    const month = parts.at(1)
    const day = parts.at(2)

    if (!year || !month || !day) {
        return null
    }

    const date = createLocalDate(year, month - 1, day)

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : null
}

export function formatDateValue(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

export function startOfMonth(date: Date): Date {
    return createLocalDate(date.getFullYear(), date.getMonth(), 1)
}

export function addDays(date: Date, amount: number): Date {
    return createLocalDate(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

export function addMonths(date: Date, amount: number): Date {
    const targetMonth = createLocalDate(date.getFullYear(), date.getMonth() + amount, 1)
    const lastDay = createLocalDate(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
    ).getDate()

    return createLocalDate(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        Math.min(date.getDate(), lastDay),
    )
}

export function getInitialMonth(value: DateRangeValue): Date {
    return startOfMonth(parseDateValue(value.from) ?? parseDateValue(value.to) ?? getToday())
}

export function getRangeLabel(value: DateRangeValue): string {
    const from = parseDateValue(value.from)
    const to = parseDateValue(value.to)

    if (!from) {
        return 'Any date'
    }

    if (!to) {
        return `From ${shortDateFormatter.format(from)}`
    }

    return `${shortDateFormatter.format(from)} – ${shortDateFormatter.format(to)}`
}

export function formatShortDate(date: Date | null): string {
    return date ? shortDateFormatter.format(date) : 'Select date'
}

export function formatMonth(date: Date): string {
    return monthFormatter.format(date)
}

function isSameDay(first: Date | null, second: Date): boolean {
    return first?.getTime() === second.getTime()
}

export function createCalendarWeeks(
    visibleMonth: Date,
    from: Date | null,
    to: Date | null,
    today: Date,
): ReadonlyArray<ReadonlyArray<CalendarDayViewModel>> {
    const firstDay = startOfMonth(visibleMonth)
    const mondayOffset = (firstDay.getDay() + 6) % 7
    const gridStart = addDays(firstDay, -mondayOffset)
    const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)).map(
        (date): CalendarDayViewModel => ({
            dateValue: formatDateValue(date),
            dayNumber: date.getDate(),
            fullDateLabel: fullDateFormatter.format(date),
            isCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
            isInRange: Boolean(
                from && to && date.getTime() > from.getTime() && date.getTime() < to.getTime(),
            ),
            isRangeEnd: isSameDay(to, date),
            isRangeStart: isSameDay(from, date),
            isToday: isSameDay(today, date),
        }),
    )

    return Array.from({ length: 6 }, (_, weekIndex) => days.slice(weekIndex * 7, weekIndex * 7 + 7))
}

export function getKeyboardTargetDate(date: Date, key: string): Date | null {
    const mondayIndex = (date.getDay() + 6) % 7

    switch (key) {
        case 'ArrowLeft':
            return addDays(date, -1)
        case 'ArrowRight':
            return addDays(date, 1)
        case 'ArrowUp':
            return addDays(date, -7)
        case 'ArrowDown':
            return addDays(date, 7)
        case 'Home':
            return addDays(date, -mondayIndex)
        case 'End':
            return addDays(date, 6 - mondayIndex)
        case 'PageUp':
            return addMonths(date, -1)
        case 'PageDown':
            return addMonths(date, 1)
        default:
            return null
    }
}

export function createSelectedRange(
    selectedDate: Date,
    from: Date | null,
    to: Date | null,
): { readonly completed: boolean; readonly value: DateRangeValue } {
    const selectedValue = formatDateValue(selectedDate)

    if (!from || to) {
        return { completed: false, value: { from: selectedValue } }
    }

    return {
        completed: true,
        value:
            selectedDate.getTime() < from.getTime()
                ? { from: selectedValue, to: formatDateValue(from) }
                : { from: formatDateValue(from), to: selectedValue },
    }
}
