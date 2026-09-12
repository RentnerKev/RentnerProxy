import { CalendarDays } from 'lucide-react'
import * as Popover from 'radix-ui/popover'

import useTranslationStore from '../../../language/useTranslationStore'
import SelectControl from '../../Select'
import CalendarMonthView from './CalendarMonthView'
import useDateTimeCalendarLogic from '../Hooks/useDateTimeCalendarLogic'
import type { DateTimeCalendarProps } from '../Types/date-time-calendar.types'

const triggerClassName =
    'group inline-flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input-border bg-surface-raised px-3 text-left text-sm text-ink outline-hidden transition-[border-color,box-shadow,background-color] hover:border-border-strong focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-55 data-[invalid=true]:border-danger-text'

export default function DateTimeCalendar({
    ariaLabel,
    describedBy,
    disabled = false,
    invalid = false,
    onValueChange,
    value,
}: DateTimeCalendarProps) {
    const { t } = useTranslationStore()
    const { contentRef, handler, state } = useDateTimeCalendarLogic({ onValueChange, value })

    return (
        <Popover.Root open={state.open} onOpenChange={handler.handleOpenChange}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={ariaLabel}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    data-invalid={invalid || undefined}
                    disabled={disabled}
                    className={triggerClassName}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <CalendarDays
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted"
                            strokeWidth={1.7}
                        />
                        <span
                            className={`truncate ${state.dateValue ? 'text-ink' : 'text-muted-soft'}`}
                        >
                            {state.triggerLabel}
                        </span>
                    </span>
                    <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-brand-500 opacity-0 transition-opacity group-data-[state=open]:opacity-100"
                    />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    ref={contentRef}
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    aria-label={ariaLabel}
                    onOpenAutoFocus={handler.handleOpenAutoFocus}
                    className="relative z-[70] flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised text-ink shadow-panel outline-hidden before:pointer-events-none before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/75 before:to-transparent data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 motion-reduce:animate-none"
                >
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                        <div className="p-3">
                            <CalendarMonthView
                                focusedDateValue={state.focusedDateValue}
                                monthLabel={state.monthLabel}
                                onNextMonth={handler.showNextMonth}
                                onPreviousMonth={handler.showPreviousMonth}
                                weeks={state.weeks}
                                onDayFocus={handler.handleDayFocus}
                                onDayKeyDown={handler.handleDayKeyDown}
                                onSelectDate={handler.handleSelectDate}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2 border-t border-border bg-surface-subtle p-3">
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                <span>{t('calendar.hours')}</span>
                                <SelectControl
                                    ariaLabel={t('calendar.hours')}
                                    className="h-12 w-full"
                                    disabled={disabled || !state.dateValue}
                                    value={state.hour}
                                    placeholder={t('calendar.selectDate')}
                                    options={state.hours}
                                    onValueChange={handler.handleHourChange}
                                />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                <span>{t('calendar.minutes')}</span>
                                <SelectControl
                                    ariaLabel={t('calendar.minutes')}
                                    className="h-12 w-full"
                                    disabled={disabled || !state.dateValue}
                                    value={state.minute}
                                    placeholder={t('calendar.selectDate')}
                                    options={state.minutes}
                                    onValueChange={handler.handleMinuteChange}
                                />
                            </label>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-3 py-2.5">
                            <p className="min-w-0 flex-1 text-[0.68rem] leading-snug text-muted">
                                {state.dateValue
                                    ? `${state.dateLabel} · ${state.timeLabel}`
                                    : t('calendar.selectDate')}
                            </p>
                            {state.dateValue ? (
                                <button
                                    type="button"
                                    onClick={handler.clear}
                                    className="inline-flex h-12 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs font-extrabold text-muted transition-colors hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                >
                                    {t('calendar.clear')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <Popover.Arrow className="fill-border" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
