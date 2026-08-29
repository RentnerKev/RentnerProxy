import { calendarWeekdayLabels } from '../Helpers/dateRangeCalendar.helpers'
import type { CalendarMonthGridProps } from '../Types/date-range-calendar.types'

export default function CalendarMonthGrid({
    focusedDateValue,
    onDayFocus,
    onDayKeyDown,
    onSelectDate,
    weeks,
}: CalendarMonthGridProps) {
    return (
        <table aria-label="Calendar dates" className="w-full">
            <thead>
                <tr>
                    {calendarWeekdayLabels.map((label) => (
                        <th
                            key={label}
                            scope="col"
                            className="h-7 text-center font-mono text-[0.58rem] font-bold tracking-[0.08em] text-muted uppercase"
                        >
                            {label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {weeks.map((week) => (
                    <tr key={week[0]!.dateValue}>
                        {week.map((day) => (
                            <td key={day.dateValue} className="w-[14.2857%] p-px">
                                <button
                                    type="button"
                                    data-calendar-date={day.dateValue}
                                    tabIndex={day.dateValue === focusedDateValue ? 0 : -1}
                                    aria-label={day.fullDateLabel}
                                    aria-pressed={day.isRangeStart || day.isRangeEnd}
                                    onFocus={() => onDayFocus(day.dateValue)}
                                    onKeyDown={(event) => onDayKeyDown(event, day.dateValue)}
                                    onClick={() => onSelectDate(day.dateValue)}
                                    className={`relative grid aspect-square w-full min-w-0 place-items-center rounded-lg text-xs font-bold outline-hidden transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised motion-reduce:transition-none ${day.isRangeStart || day.isRangeEnd ? 'bg-brand-500 text-navy-950 shadow-[0_5px_14px_rgb(15_179_58_/_24%)]' : day.isInRange ? 'rounded-sm bg-success-bg text-success-text' : day.isCurrentMonth ? 'text-ink-soft hover:bg-surface-hover hover:text-brand-text' : 'text-muted-soft/55 hover:bg-surface-hover hover:text-muted'} ${day.isToday && !day.isRangeStart && !day.isRangeEnd ? 'ring-1 ring-brand-600/45' : ''}`}
                                >
                                    {day.dayNumber}
                                </button>
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
