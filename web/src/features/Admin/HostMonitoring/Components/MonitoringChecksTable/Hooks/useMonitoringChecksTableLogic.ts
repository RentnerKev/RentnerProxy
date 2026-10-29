import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef, FilterFn } from '@tanstack/react-table'
import { createElement, useMemo, useState } from 'react'
import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import { createDateRangeFilter } from '@/lib/Table/tableFilters.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import HostAvailabilityBadge from '../../HostAvailabilityBadge.tsx'
import type {
    MonitoringChecksTableLogicResult,
    MonitoringChecksTableProps,
} from '../Types/checks-table.types.ts'

const getRowId = (observation: HostMonitoringObservationView) => observation.id
const dateFilter = createDateRangeFilter<HostMonitoringObservationView>()

export default function useMonitoringChecksTableLogic(
    observations: MonitoringChecksTableProps['observations'],
): MonitoringChecksTableLogicResult {
    const { t, locale } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...observations], [observations])
    const formatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
        [locale],
    )
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, HostMonitoringObservationView>>>(
        () => [
            {
                accessorKey: 'checkedAt',
                header: t('admin.hostMonitoring.checkedAt'),
                sortFn: sortFn_datetime,
                filterFn: dateFilter,
                cell: ({ row }) =>
                    createElement(
                        'time',
                        {
                            dateTime: row.original.checkedAt.toISOString(),
                            className: 'whitespace-nowrap',
                        },
                        formatter.format(row.original.checkedAt),
                    ),
            },
            {
                accessorKey: 'status',
                header: t('admin.hostMonitoring.status'),
                filterFn: filterFn_equalsString,
                cell: ({ row }) =>
                    createElement(HostAvailabilityBadge, { availability: row.original.status }),
            },
            {
                id: 'durationMs',
                accessorFn: (row) => row.durationMs ?? undefined,
                header: t('admin.hostMonitoring.duration'),
                enableColumnFilter: false,
                sortUndefined: 'last',
                cell: ({ row }) =>
                    createElement(
                        'span',
                        { className: 'whitespace-nowrap font-mono' },
                        row.original.durationMs === null ? '—' : `${row.original.durationMs} ms`,
                    ),
            },
            {
                id: 'httpStatus',
                accessorFn: (row) => row.httpStatus ?? undefined,
                header: t('admin.hostMonitoring.httpStatus'),
                sortUndefined: 'last',
                filterFn: (row, _columnId, value) =>
                    String(row.original.httpStatus ?? 'missing') === String(value),
                cell: ({ row }) =>
                    createElement(
                        'span',
                        { className: 'font-mono' },
                        row.original.httpStatus ?? '—',
                    ),
            },
            {
                accessorKey: 'code',
                header: t('admin.hostMonitoring.outcome'),
                filterFn: filterFn_equalsString,
                cell: ({ row }) => t(`admin.hostMonitoring.codes.${row.original.code}`),
            },
        ],
        [formatter, t],
    )
    const globalFilterFn = useMemo<FilterFn<ClientTableFeatures, HostMonitoringObservationView>>(
        () => (row, _columnId, value) => {
            const search = String(value).trim().toLocaleLowerCase(locale)
            const observation = row.original
            return [
                formatter.format(observation.checkedAt),
                t(`admin.hostMonitoring.states.${observation.status}`),
                t(`admin.hostMonitoring.codes.${observation.code}`),
                observation.durationMs === null ? '' : `${observation.durationMs} ms`,
                observation.httpStatus ?? '',
            ]
                .join(' ')
                .toLocaleLowerCase(locale)
                .includes(search)
        },
        [formatter, locale, t],
    )
    const { table, state, handler } = useClientTable({
        data,
        columns,
        getRowId,
        initialSorting: [{ id: 'checkedAt', desc: true }],
        globalFilterFn,
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            checkedAt: { type: 'dateRange' },
            status: {
                type: 'select',
                placeholder: t('admin.hostMonitoring.all'),
                options: (['healthy', 'unhealthy', 'unknown'] as const).map((value) => ({
                    value,
                    label: t(`admin.hostMonitoring.states.${value}`),
                })),
            },
            httpStatus: {
                type: 'select',
                placeholder: t('admin.hostMonitoring.table.allHttpStatuses'),
                options: [...new Set(data.map((row) => row.httpStatus))]
                    .toSorted((a, b) => (a ?? 0) - (b ?? 0))
                    .map((value) => ({
                        value: String(value ?? 'missing'),
                        label:
                            value === null
                                ? t('admin.hostMonitoring.table.missingHttpStatus')
                                : String(value),
                    })),
            },
            code: {
                type: 'select',
                placeholder: t('admin.hostMonitoring.table.allOutcomes'),
                options: [...new Set(data.map((row) => row.code))].map((value) => ({
                    value,
                    label: t(`admin.hostMonitoring.codes.${value}`),
                })),
            },
        }),
        [data, t],
    )
    return {
        table,
        state: { searchInput: state.searchInput, showColumnFilters, columnFilterConfigs },
        handler: {
            handleSearchInputChange: handler.handleSearchInputChange,
            handleResetFilters: handler.handleResetFilters,
            handleToggleColumnFilters: () => setShowColumnFilters((value) => !value),
        },
    }
}
