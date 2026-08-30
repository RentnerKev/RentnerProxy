import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as Popover from 'radix-ui/popover'

import useTranslationStore from '../../../language/useTranslationStore'
import type { CalendarPopoverContentProps } from '../Types/date-range-calendar.types'
import CalendarMonthGrid from './CalendarMonthGrid'

export default function CalendarPopoverContent({
    ariaLabel,
    contentRef,
    fromLabel,
    handler,
    state,
    toLabel,
}: CalendarPopoverContentProps) {
    const { t } = useTranslationStore()

    return (
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
                    <div className="grid grid-cols-2 gap-2 border-b border-border bg-surface-subtle p-3">
                        <div className="min-w-0 rounded-xl border border-border bg-surface-raised px-3 py-2">
                            <span className="block font-mono text-[0.58rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {fromLabel}
                            </span>
                            <strong className="mt-0.5 block truncate text-xs text-ink-soft">
                                {state.fromDateLabel}
                            </strong>
                        </div>
                        <div className="min-w-0 rounded-xl border border-border bg-surface-raised px-3 py-2">
                            <span className="block font-mono text-[0.58rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {toLabel}
                            </span>
                            <strong className="mt-0.5 block truncate text-xs text-ink-soft">
                                {state.toDateLabel}
                            </strong>
                        </div>
                    </div>

                    <div className="p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                aria-label={t('calendar.previousMonth')}
                                onClick={handler.showPreviousMonth}
                                className="grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                            >
                                <ChevronLeft
                                    aria-hidden="true"
                                    className="size-4"
                                    strokeWidth={1.8}
                                />
                            </button>
                            <h3 className="text-sm font-extrabold text-ink-soft" aria-live="polite">
                                {state.monthLabel}
                            </h3>
                            <button
                                type="button"
                                aria-label={t('calendar.nextMonth')}
                                onClick={handler.showNextMonth}
                                className="grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                            >
                                <ChevronRight
                                    aria-hidden="true"
                                    className="size-4"
                                    strokeWidth={1.8}
                                />
                            </button>
                        </div>

                        <CalendarMonthGrid
                            focusedDateValue={state.focusedDateValue}
                            weeks={state.weeks}
                            onDayFocus={handler.handleDayFocus}
                            onDayKeyDown={handler.handleDayKeyDown}
                            onSelectDate={handler.handleSelectDate}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-3 py-2.5">
                        <p className="min-w-0 flex-1 text-[0.68rem] leading-snug text-muted">
                            {state.hint}
                        </p>
                        {state.hasFrom || state.hasTo ? (
                            <button
                                type="button"
                                onClick={handler.clear}
                                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-muted transition-colors hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                            >
                                {t('calendar.clear')}
                            </button>
                        ) : null}
                    </div>
                </div>
                <Popover.Arrow className="fill-border" />
            </Popover.Content>
        </Popover.Portal>
    )
}
