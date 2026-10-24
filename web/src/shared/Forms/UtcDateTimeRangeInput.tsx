import { RangeCalendar } from '@rentnerkev/calendar/range-calendar'

import { CALENDAR_CUSTOM_DESIGN, CALENDAR_TRIGGER_CLASS_NAME } from '@/config/calendar.config.ts'
import useUtcDateTimeRangeInputLogic from '@/shared/Calendar/Hooks/useUtcDateTimeRangeInputLogic.ts'
import type { UtcDateTimeRangeInputProps } from './Types/utc-date-time-range-input.types.ts'

export default function UtcDateTimeRangeInput({
    ariaLabel,
    describedBy,
    disabled = false,
    invalid = false,
    onValueChange,
    value,
}: UtcDateTimeRangeInputProps) {
    const { handler, state } = useUtcDateTimeRangeInputLogic({ onValueChange, value })
    const invalidClassName = invalid ? '!border-danger-text' : ''

    return (
        <RangeCalendar
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={state.range}
            onChange={handler.handleRangeChange}
            className={`h-12 w-full rounded-xl ${CALENDAR_TRIGGER_CLASS_NAME} ${invalidClassName}`}
            enableTime
            valueFormat="iso-datetime"
            closeOnSelect={false}
            customDesign={CALENDAR_CUSTOM_DESIGN}
            disabled={disabled}
            fastEdit={false}
            isDeletable
            locale={state.presentation.locale}
            messages={state.presentation.messages}
            placeholder={state.presentation.t('calendar.selectRange')}
            weekStartsOn={1}
        />
    )
}
