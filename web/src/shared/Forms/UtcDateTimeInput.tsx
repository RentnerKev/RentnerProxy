import { NativeTimeInput } from '@rentnerkev/inputs'
import { SingleCalendar } from '@rentnerkev/calendar/single-calendar'

import { CALENDAR_CUSTOM_DESIGN } from '../../config/calendar.config'
import useUtcDateTimeInputLogic from '../Calendar/Hooks/useUtcDateTimeInputLogic'
import type { UtcDateTimeInputProps } from './Types/utc-date-time-input.types'

export default function UtcDateTimeInput({
    ariaLabel,
    describedBy,
    disabled = false,
    invalid = false,
    onValueChange,
    value,
}: UtcDateTimeInputProps) {
    const { handler, state } = useUtcDateTimeInputLogic({ onValueChange, value })
    const invalidClassName = invalid ? '!border-danger-text' : ''

    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7.25rem] gap-2">
            <SingleCalendar
                aria-label={ariaLabel}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={state.date}
                onChange={handler.handleDateChange}
                className={`h-12 w-full rounded-xl text-left ${invalidClassName}`}
                closeOnSelect
                customDesign={CALENDAR_CUSTOM_DESIGN}
                disabled={disabled}
                fastEdit={false}
                isDeletable
                locale={state.presentation.locale}
                messages={state.presentation.messages}
                placeholder={state.presentation.t('calendar.selectDate')}
                weekStartsOn={1}
            />
            <NativeTimeInput
                type="time"
                step={60}
                aria-label={`${ariaLabel} · ${state.presentation.t('calendar.time')}`}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={disabled || !state.hasValue}
                value={state.time}
                onChange={(event) => handler.handleTimeChange(event.currentTarget.value)}
                className={`h-12 min-w-0 rounded-xl border border-input-border bg-surface-raised px-2 text-sm text-ink outline-hidden transition-[border-color,box-shadow] focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-55 ${invalidClassName}`}
            />
        </div>
    )
}
