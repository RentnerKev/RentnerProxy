import { RangeCalendar } from '@rentnerkev/calendar/range-calendar'
import type { RowData } from '@tanstack/react-table'

import SelectControl, { SearchableSelect } from '../../Select'
import { CALENDAR_CUSTOM_DESIGN } from '../../../config/calendar.config'
import {
    getRangeCalendarInputValue,
    getTableDateRangeFilterValue,
} from '../Helpers/calendarFilterValue.helpers'
import useCalendarPresentation from '../../Calendar/Hooks/useCalendarPresentation'
import type { TableColumnFilterInputProps } from '../Types/table.types'

const controlClassName =
    'box-border h-12 min-w-0 w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm font-normal text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/15'

export default function TableColumnFilterInput<TData extends RowData>({
    column,
    config,
}: TableColumnFilterInputProps<TData>) {
    const calendar = useCalendarPresentation()
    const { t } = calendar

    if (config.type === 'select') {
        const filterColumnLabel = t('table.filterColumn')
        const allLabel = t('table.all')

        return (
            <SelectControl
                value={String(column.getFilterValue() ?? '')}
                ariaLabel={config.placeholder ?? filterColumnLabel}
                placeholder={config.placeholder ?? allLabel}
                options={config.options}
                onValueChange={(value) => column.setFilterValue(value || undefined)}
                className="w-full"
            />
        )
    }

    if (config.type === 'searchableSelect') {
        const filterColumnLabel = t('table.filterColumn')
        const allLabel = t('table.all')

        return (
            <SearchableSelect
                value={String(column.getFilterValue() ?? '')}
                ariaLabel={config.placeholder ?? filterColumnLabel}
                allLabel={allLabel}
                placeholder={config.placeholder ?? allLabel}
                searchPlaceholder={
                    config.searchPlaceholder ?? config.placeholder ?? filterColumnLabel
                }
                noResultsLabel={config.noResultsLabel ?? t('table.noResults')}
                options={config.options}
                onChange={(value) => column.setFilterValue(value || undefined)}
            />
        )
    }

    if (config.type === 'dateRange') {
        return (
            <RangeCalendar
                aria-label={t('table.filterByDateRange')}
                value={getRangeCalendarInputValue(column.getFilterValue())}
                onChange={(value) => column.setFilterValue(getTableDateRangeFilterValue(value))}
                className="h-12 w-full rounded-xl"
                closeOnSelect
                customDesign={CALENDAR_CUSTOM_DESIGN}
                fastEdit={false}
                isDeletable
                locale={calendar.locale}
                messages={calendar.messages}
                placeholder={t('calendar.anyDate')}
                weekStartsOn={1}
            />
        )
    }

    return (
        <input
            type="text"
            value={String(column.getFilterValue() ?? '')}
            maxLength={config.maxLength}
            aria-label={config.placeholder ?? t('table.filterColumn')}
            placeholder={config.placeholder ?? t('table.filterEllipsis')}
            onChange={(event) => column.setFilterValue(event.target.value || undefined)}
            className={controlClassName}
        />
    )
}
