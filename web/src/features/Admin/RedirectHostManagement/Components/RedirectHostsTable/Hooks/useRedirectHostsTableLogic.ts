import type { RedirectHostsTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import { createSortedUniqueFilterOptions } from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import type { RedirectHostsTableProps } from '../../../Types/redirect-host-table.types.ts'
import useRedirectHostsTableColumns from './useRedirectHostsTableColumns.ts'
const getRowId = (host: RedirectHostSummary) => host.id
const globalFilter =
    (
        t: ReturnType<typeof useTranslationStore>['t'],
        locale: string,
    ): FilterFn<ClientTableFeatures, RedirectHostSummary> =>
    (row, _id, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const host = row.original
        const status = host.enabled ? 'enabled' : 'disabled'
        return [
            ...host.domains,
            host.destination,
            String(host.statusCode),
            t('admin.redirectHosts.status.' + status),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }
export default function useRedirectHostsTableLogic(
    props: RedirectHostsTableProps,
): RedirectHostsTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.redirectHosts], [props.redirectHosts])
    const columns = useRedirectHostsTableColumns(props)
    const tableLogic = useClientTable({
        data,
        columns,
        getRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => globalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            domains: {
                type: 'searchableSelect',
                placeholder: t('admin.redirectHosts.filters.domains'),
                options: createSortedUniqueFilterOptions(data.flatMap((host) => host.domains)),
            },
            statusCode: {
                type: 'select',
                placeholder: t('admin.redirectHosts.filters.allStatusCodes'),
                options: [301, 302, 307, 308].map((code) => ({
                    label: t('admin.redirectHosts.statusCodes.' + code),
                    value: String(code),
                })),
            },
            status: {
                type: 'select',
                placeholder: t('admin.redirectHosts.filters.allStatuses'),
                options: [
                    { label: t('admin.redirectHosts.status.enabled'), value: 'enabled' },
                    { label: t('admin.redirectHosts.status.disabled'), value: 'disabled' },
                ],
            },
            createdAt: {
                type: 'dateRange',
            },
        }),
        [data, t],
    )
    return {
        table: tableLogic.table,
        state: {
            searchInput: tableLogic.state.searchInput,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            handleSearchInputChange: tableLogic.handler.handleSearchInputChange,
            handleResetFilters: tableLogic.handler.handleResetFilters,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
