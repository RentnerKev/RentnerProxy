import { matchesHostSearch } from '@/lib/HostTags/hostList.ts'
import type { Translate } from '../Types/proxy-hosts-table-logic.types.ts'
import type { ProxyHostsTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import useHostBulkSelection from '@/features/Admin/HostBulkActions/Hooks/useHostBulkSelection.ts'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import { createSortedUniqueFilterOptions } from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { ProxyHostsTableProps } from '../../../Types/proxy-host-table.types.ts'
import useProxyHostsTableColumns from './useProxyHostsTableColumns.ts'

const getProxyHostRowId = (host: ProxyHostSummary) => host.id

const createProxyHostGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, ProxyHostSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const host = row.original

        const status = host.enabled ? 'enabled' : 'disabled'
        return matchesHostSearch(host, search, locale, t('admin.proxyHosts.status.' + status), [
            status,
            t('admin.proxyHosts.scheme.' + host.forwardScheme),
        ])
    }

export default function useProxyHostsTableLogic(
    props: ProxyHostsTableProps,
): ProxyHostsTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.proxyHosts], [props.proxyHosts])
    const selection = useHostBulkSelection<ProxyHostSummary>({
        kind: 'proxy',
        permissions: props.bulkPermissions ?? [],
        scope: JSON.stringify([
            props.remote?.initialState.globalFilter,
            props.remote?.initialState.columnFilters,
        ]),
        disabled: props.isPending || props.loading,
    })
    const hostColumns = useProxyHostsTableColumns(props)
    const columns = useMemo(
        () => (selection.state.enabled ? [selection.column, ...hostColumns] : hostColumns),
        [hostColumns, selection.column, selection.state.enabled],
    )
    const tableLogic = useClientTable({
        ...(props.remote ? { remote: props.remote } : {}),
        data,
        columns,
        getRowId: getProxyHostRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createProxyHostGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            domains: {
                type: 'searchableSelect',
                placeholder: t('admin.proxyHosts.filters.domains'),
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
            forward: {
                type: 'select',
                placeholder: t('admin.proxyHosts.filters.allSchemes'),
                options: [
                    { label: t('admin.proxyHosts.scheme.http'), value: 'http' },
                    { label: t('admin.proxyHosts.scheme.https'), value: 'https' },
                ],
            },
            status: {
                type: 'select',
                placeholder: t('admin.proxyHosts.filters.allStatuses'),
                options: [
                    { label: t('admin.proxyHosts.status.enabled'), value: 'enabled' },
                    { label: t('admin.proxyHosts.status.disabled'), value: 'disabled' },
                ],
            },
            createdAt: {
                type: 'dateRange',
            },
        }),
        [data, props.remote?.domains, props.remote?.tags, t],
    )

    const clearSelection = selection.handler.clear
    const { columnFilters, globalFilter } = tableLogic.table.atoms
    useEffect(() => {
        const subscriptions = [
            columnFilters.subscribe(clearSelection),
            globalFilter.subscribe(clearSelection),
        ]
        return () => subscriptions.forEach((subscription) => subscription.unsubscribe())
    }, [clearSelection, columnFilters, globalFilter])

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
