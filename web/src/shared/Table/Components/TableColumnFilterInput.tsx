import type { RowData } from '@tanstack/react-table'

import DateRangeCalendar from '../../Calendar'
import SelectControl from '../../Select'
import getDateRangeFilterValue from '../Helpers/getDateRangeFilterValue'
import type { TableColumnFilterInputProps } from '../Types/table.types'

const controlClassName =
    'h-9 min-w-0 w-full rounded-lg border border-input-border bg-surface-raised px-2.5 text-xs font-normal text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/15'

export default function TableColumnFilterInput<TData extends RowData>({
    column,
    config,
}: TableColumnFilterInputProps<TData>) {
    if (config.type === 'select') {
        return (
            <SelectControl
                value={String(column.getFilterValue() ?? '')}
                ariaLabel={config.placeholder ?? 'Filter column'}
                placeholder={config.placeholder ?? 'All'}
                options={config.options}
                onValueChange={(value) => column.setFilterValue(value || undefined)}
                className="w-full"
            />
        )
    }

    if (config.type === 'dateRange') {
        return (
            <DateRangeCalendar
                value={getDateRangeFilterValue(column.getFilterValue())}
                ariaLabel="Filter by date range"
                fromLabel={config.fromLabel}
                toLabel={config.toLabel}
                onValueChange={(value) => column.setFilterValue(value)}
            />
        )
    }

    return (
        <input
            type="text"
            value={String(column.getFilterValue() ?? '')}
            maxLength={config.maxLength}
            aria-label={config.placeholder ?? 'Filter column'}
            placeholder={config.placeholder ?? 'Filter…'}
            onChange={(event) => column.setFilterValue(event.target.value || undefined)}
            className={controlClassName}
        />
    )
}
