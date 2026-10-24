import { useMemo } from 'react'

import { parseUtcDateTimeValue } from '@/lib/Calendar/utcDateTime.ts'
import useCalendarPresentation from './useCalendarPresentation.ts'
import type {
    UtcDateTimeRangeInputLogic,
    UtcDateTimeRangeInputProps,
} from '@/shared/Forms/Types/utc-date-time-range-input.types.ts'

export default function useUtcDateTimeRangeInputLogic({
    onValueChange,
    value,
}: Pick<UtcDateTimeRangeInputProps, 'onValueChange' | 'value'>): UtcDateTimeRangeInputLogic {
    const presentation = useCalendarPresentation()
    const range = useMemo<readonly [string | null, string | null] | null>(() => {
        const from = parseUtcDateTimeValue(value.from) ? `${value.from}:00.000Z` : null
        const to = parseUtcDateTimeValue(value.to) ? `${value.to}:00.000Z` : null
        return from || to ? [from, to] : null
    }, [value.from, value.to])

    return {
        state: {
            range,
            presentation,
        },
        handler: {
            handleRangeChange(selection) {
                onValueChange({
                    from: selection?.[0]?.slice(0, 16) ?? '',
                    to: selection?.[1]?.slice(0, 16) ?? '',
                })
            },
        },
    }
}
