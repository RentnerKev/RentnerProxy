import { describe, expect, test } from 'bun:test'
import type { Row } from '@tanstack/react-table'

import { createDateRangeFilter } from '../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../shared/Table/Hooks/useClientTableLogic'
import type { TableDateRangeFilterValue } from '../shared/Table/Types/table.types'

type DateRow = { createdAt: string }

function matchesDate(value: unknown, range: TableDateRangeFilterValue) {
    // This unit only reads getValue; the remaining TanStack row APIs are not exercised.
    const row = { getValue: () => value } as unknown as Row<ClientTableFeatures, DateRow>
    return createDateRangeFilter<DateRow>()(row, 'createdAt', range, () => {})
}

describe('localized table date filtering', () => {
    test('uses the same inclusive UTC calendar day as the displayed date in every locale', () => {
        const range = { from: '2026-01-10', to: '2026-01-10' }
        expect(matchesDate('2026-01-09T23:59:59.999Z', range)).toBe(false)
        expect(matchesDate('2026-01-10T00:00:00.000Z', range)).toBe(true)
        expect(matchesDate('2026-01-10T23:59:59.999Z', range)).toBe(true)
        expect(matchesDate('2026-01-11T00:00:00.000Z', range)).toBe(false)
    })

    test('handles one-sided ranges, Date values and invalid timestamps', () => {
        expect(matchesDate(new Date('2026-01-10T00:00:00Z'), { from: '2026-01-10' })).toBe(true)
        expect(matchesDate('2026-01-10T23:59:59.999Z', { to: '2026-01-10' })).toBe(true)
        expect(matchesDate('2026-01-11T00:00:00Z', { to: '2026-01-10' })).toBe(false)
        expect(matchesDate('invalid', {})).toBe(false)
    })
})
