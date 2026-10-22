import { matchesHostSearch } from '@/lib/HostTags/hostList.ts'
import type { RedirectHostsTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import useHostBulkSelection from '@/features/Admin/HostBulkActions/Hooks/useHostBulkSelection.ts'
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
        return matchesHostSearch(host, search, locale, t('admin.redirectHosts.status.' + status))
    }
export default function useRedirectHostsTableLogic(
    props: RedirectHostsTableProps,
): RedirectHostsTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.redirectHosts], [props.redirectHosts])
    const selection = useHostBulkSelection<RedirectHostSummary>({
        kind: 'redirect',
        permissions: props.bulkPermissions ?? [],
        scope: JSON.stringify([
            props.remote?.initialState.globalFilter,
            props.remote?.initialState.columnFilters,
        ]),
        disabled: props.isPending || props.loading,
    })
    const hostColumns = useRedirectHostsTableColumns(props)
    const columns = useMemo(
        () => (selection.state.enabled ? [selection.column, ...hostColumns] : hostColumns),
        [hostColumns, selection.column, selection.state.enabled],
    )
    const tableLogic = useClientTable({
        ...(props.remote ? { remote: props.remote } : {}),
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
                options: createSortedUniqueFilterOptions(
                    props.remote?.domains ?? data.flatMap((host) => host.domains),
                ),
            },
            tags: {
                type: 'searchableSelect',
                placeholder: t('admin.hostTags.filter'),
                options: [
                    { value: 'untagged', label: t('admin.hostTags.untagged') },
                    ...(props.remote?.tags ?? []).map((tag) => ({
                        value: tag.id,
                        label: tag.name,
                    })),
                ],
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
        [data, props.remote?.domains, props.remote?.tags, t],
    )
    const clearSelection = selection.handler.clear
    const { columnFilters, globalFilter: globalFilterAtom } = tableLogic.table.atoms
    useEffect(() => {
        const subscriptions = [
            columnFilters.subscribe(clearSelection),
            globalFilterAtom.subscribe(clearSelection),
        ]
        return () => subscriptions.forEach((subscription) => subscription.unsubscribe())
    }, [clearSelection, columnFilters, globalFilterAtom])
    return {
        table: tableLogic.table,
        state: {
            bulkIds: selection.state.ids,
            bulkOpen: selection.state.open,
            bulkEnabled: selection.state.enabled,
            bulkDisabled: selection.state.disabled,
            searchInput: tableLogic.state.searchInput,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            handleToggleSelection: selection.handler.toggle,
            handleSelectPage: () =>
                selection.handler.selectPage(
                    tableLogic.table.getRowModel().rows.map((row) => row.id),
                ),
            handleClearSelection: clearSelection,
            handleBulkOpenChange: selection.handler.setOpen,
            handleSearchInputChange: tableLogic.handler.handleSearchInputChange,
            handleResetFilters: tableLogic.handler.handleResetFilters,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
