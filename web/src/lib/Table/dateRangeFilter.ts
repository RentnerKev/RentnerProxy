import type { TableDateRangeFilterValue } from '@/shared/Table/Types/table.types.ts'

export default function getDateRangeFilterValue(value: unknown): TableDateRangeFilterValue {
    if (typeof value !== 'object' || value === null) {
        return {}
    }

    const from = 'from' in value && typeof value.from === 'string' ? value.from : undefined
    const to = 'to' in value && typeof value.to === 'string' ? value.to : undefined

    return {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
    }
}
