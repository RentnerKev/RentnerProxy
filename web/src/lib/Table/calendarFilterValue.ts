import { serializeCalendarValue } from '@rentnerkev/calendar/value'
import type { RangeCalendarInputValue, RangeCalendarValue } from '@rentnerkev/calendar/types'

import getDateRangeFilterValue from './dateRangeFilter.ts'
import type { TableDateRangeFilterValue } from '@/shared/Table/Types/table.types.ts'

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
