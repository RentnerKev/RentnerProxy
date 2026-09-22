import { TextInput } from '@rentnerkev/inputs'
import { RangeCalendar } from '@rentnerkev/calendar/range-calendar'
import { CustomSelect } from '@rentnerkev/select/select'
import type { RowData } from '@tanstack/react-table'

import {
    CALENDAR_CUSTOM_DESIGN,
    CALENDAR_TRIGGER_CLASS_NAME,
} from '../../../config/calendar.config'
import {
    getRangeCalendarInputValue,
    getTableDateRangeFilterValue,
} from '../Helpers/calendarFilterValue.helpers'
import useCalendarPresentation from '../../Calendar/Hooks/useCalendarPresentation'
import type { TableColumnFilterInputProps } from '../Types/table.types'

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
            <CustomSelect
                value={String(column.getFilterValue() ?? '')}
                aria-label={config.placeholder ?? filterColumnLabel}
                placeholder={config.placeholder ?? allLabel}
                options={[{ value: '', label: config.placeholder ?? allLabel }, ...config.options]}
                onValueChange={(value) => column.setFilterValue(value || undefined)}
                searchable={false}
            />
        )
    }

    if (config.type === 'searchableSelect') {
        const filterColumnLabel = t('table.filterColumn')
        const allLabel = t('table.all')

        return (
            <CustomSelect
                value={String(column.getFilterValue() ?? '')}
                aria-label={config.placeholder ?? filterColumnLabel}
                placeholder={config.placeholder ?? allLabel}
                messages={{
                    searchPlaceholder:
                        config.searchPlaceholder ?? config.placeholder ?? filterColumnLabel,
                    noResults: config.noResultsLabel ?? t('table.noResults'),
                }}
                searchable
                options={[{ value: '', label: allLabel }, ...config.options]}
                onValueChange={(value) => column.setFilterValue(value || undefined)}
            />
        )
    }

    if (config.type === 'dateRange') {
        return (
            <RangeCalendar
                aria-label={t('table.filterByDateRange')}
                value={getRangeCalendarInputValue(column.getFilterValue())}
                onChange={(value) => column.setFilterValue(getTableDateRangeFilterValue(value))}
                className={`h-12 w-full rounded-xl ${CALENDAR_TRIGGER_CLASS_NAME}`}
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
        <TextInput
            type="text"
            value={String(column.getFilterValue() ?? '')}
            maxLength={config.maxLength}
            aria-label={config.placeholder ?? t('table.filterColumn')}
            placeholder={config.placeholder ?? t('table.filterEllipsis')}
            onChange={(event) => column.setFilterValue(event.target.value || undefined)}
        />
    )
}
