import { serializeCalendarValue } from '@rentnerkev/calendar/value'
import type { RangeCalendarInputValue, RangeCalendarValue } from '@rentnerkev/calendar/types'

import getDateRangeFilterValue from './getDateRangeFilterValue'
import type { TableDateRangeFilterValue } from '../Types/table.types'

export function getRangeCalendarInputValue(value: unknown): RangeCalendarInputValue {
    const range = getDateRangeFilterValue(value)
    return [range.from ?? null, range.to ?? null]
}

export function getTableDateRangeFilterValue(
    value: RangeCalendarValue,
): TableDateRangeFilterValue | undefined {
    const serialized = serializeCalendarValue(value, { format: 'date' })
    if (!serialized) return undefined

    const [from, to] = serialized
    return from || to
        ? {
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
          }
        : undefined
}
