import { serializeCalendarISODate } from '@rentnerkev/calendar/value'

import { createUtcDateTimeValue, parseUtcDateTimeValue } from '../Helpers/utcDateTime.helpers'
import useCalendarPresentation from './useCalendarPresentation'
import type {
    UtcDateTimeInputLogic,
    UtcDateTimeInputProps,
} from '../../Forms/Types/utc-date-time-input.types'

export default function useUtcDateTimeInputLogic({
    onValueChange,
    value,
}: Pick<UtcDateTimeInputProps, 'onValueChange' | 'value'>): UtcDateTimeInputLogic {
    const presentation = useCalendarPresentation()
    const parts = parseUtcDateTimeValue(value)

    return {
        state: {
            date: parts?.date,
            hasValue: parts !== undefined,
            presentation,
            time: parts?.time ?? '',
        },
        handler: {
            handleDateChange(date) {
                if (!date) {
                    onValueChange('')
                    return
                }

                const dateValue = serializeCalendarISODate(date)
                const nextValue = dateValue
                    ? createUtcDateTimeValue(dateValue, parts?.time ?? '00:00')
                    : undefined
                if (nextValue) onValueChange(nextValue)
            },
            handleTimeChange(time) {
                if (!parts) return
                const nextValue = createUtcDateTimeValue(parts.date, time)
                if (nextValue) onValueChange(nextValue)
            },
        },
    }
}
