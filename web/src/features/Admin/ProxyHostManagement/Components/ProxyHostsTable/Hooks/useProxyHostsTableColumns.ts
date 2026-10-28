import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { CellContext, ColumnDef } from '@tanstack/react-table'
import { createElement, useCallback, useMemo } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createDateRangeFilter } from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import ProxyHostTableActions from '../Components/ProxyHostTableActions.tsx'
import HostTagsCell from '@/features/Admin/HostTags/Components/HostTagsCell.tsx'
import {
    ProxyHostCreatedAtCell,
    ProxyHostDomainsCell,
    ProxyHostForwardCell,
    ProxyHostStatusCell,
} from '../Components/ProxyHostTableCells.tsx'
import type { ProxyHostTableActionProps } from '../../../Types/proxy-host-table.types.ts'
import ProxyHostMonitoringCell from '../Components/ProxyHostMonitoringCell.tsx'

const dateFilter = createDateRangeFilter<ProxyHostSummary>()

export default function useProxyHostsTableColumns({
    canDelete,
    canDisable,
    canRequestCertificate,
    canEnable,
    canUpdate,
    canDuplicate,
    isPending,
    onConfig,
    onDelete,
    onDisable,
    onDomainCheck,
    onMonitoring,
    onEdit,
    onDuplicate,
    onEnable,
    onRequestCertificate,
}: ProxyHostTableActionProps) {
    const { t } = useTranslationStore()

    // TanStack renders this callback as a component, so translation refreshes must not replace it.
    const renderTagsCell = useCallback(
        ({ row }: CellContext<ClientTableFeatures, ProxyHostSummary>) =>
            createElement(HostTagsCell, {
                kind: 'proxy',
                hostId: row.original.id,
                hostLabel: row.original.domains[0] ?? row.original.forwardHost,
                tags: row.original.tags,
                canManage: canUpdate && !isPending,
            }),
        [canUpdate, isPending],
    )
    const tagsColumn = useMemo<ColumnDef<ClientTableFeatures, ProxyHostSummary>>(
        () => ({
            id: 'tags',
            accessorFn: (host) => (host.tags ?? []).map((tag) => tag.name).join(' '),
            header: t('admin.hostTags.title'),
            sortFn: 'text',
            filterFn: (row, _id, value) =>
                value === 'untagged'
                    ? !row.original.tags?.length
                    : Boolean(row.original.tags?.some((tag) => tag.id === value)),
            cell: renderTagsCell,
        }),
        [renderTagsCell, t],
    )

    return useMemo<Array<ColumnDef<ClientTableFeatures, ProxyHostSummary>>>(() => {
        const columns: Array<ColumnDef<ClientTableFeatures, ProxyHostSummary>> = [
            {
                id: 'domains',
                accessorFn: (host) => host.domains.join(' '),
                header: t('admin.proxyHosts.columns.domains'),
                sortFn: 'text',
                filterFn: (row, _columnId, value) => row.original.domains.includes(String(value)),
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(ProxyHostDomainsCell, {
                        domains: row.original.domains,
                        discovery: row.original.discovery,
                    }),
            },
            tagsColumn,
            {
                id: 'forward',
                accessorFn: (host) => host.forwardScheme,
                header: t('admin.proxyHosts.columns.forward'),
                enableSorting: false,
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(ProxyHostForwardCell, {
                        forwardHost: row.original.forwardHost,
                        forwardPort: row.original.forwardPort,
                        forwardScheme: row.original.forwardScheme,
                        verifyUpstreamTls: row.original.verifyUpstreamTls,
                    }),
            },
            {
                id: 'status',
                accessorFn: (host) => (host.enabled ? 'enabled' : 'disabled'),
                header: t('admin.proxyHosts.columns.status'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(ProxyHostStatusCell, {
                        enabled: row.original.enabled,
                    }),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.proxyHosts.columns.created'),
                sortFn: sortFn_datetime,
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(ProxyHostCreatedAtCell, { value: getValue() }),
            },
        ]

        if (onMonitoring) {
            columns.splice(4, 0, {
                id: 'availability',
                header: t('admin.hostMonitoring.column'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(ProxyHostMonitoringCell, {
                        host: row.original,
                        onMonitoring,
                    }),
            })
        }

        if (
            canUpdate ||
            (canDuplicate && onDuplicate) ||
            canDelete ||
            canEnable ||
            canDisable ||
            canRequestCertificate ||
            onConfig ||
            onDomainCheck ||
            onMonitoring
        ) {
            columns.push({
                id: 'actions',
                header: t('admin.proxyHosts.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(ProxyHostTableActions, {
                        canDelete,
                        canDisable,
                        canEnable,
                        canUpdate,
                        ...(canDuplicate ? { canDuplicate } : {}),
                        ...(onDuplicate ? { onDuplicate } : {}),
                        host: row.original,
                        isPending,
                        ...(onConfig ? { onConfig } : {}),
                        onDelete,
                        onDisable,
                        ...(onDomainCheck ? { onDomainCheck } : {}),
                        ...(onMonitoring ? { onMonitoring } : {}),
                        onEdit,
                        onEnable,
                        ...(onRequestCertificate ? { onRequestCertificate } : {}),
                    }),
            })
        }

        return columns
    }, [
        canDelete,
        canDisable,
        canEnable,
        canRequestCertificate,
        canUpdate,
        canDuplicate,
        isPending,
        onConfig,
        onDelete,
        onDisable,
        onDomainCheck,
        onMonitoring,
        onEdit,
        onDuplicate,
        onEnable,
        onRequestCertificate,
        tagsColumn,
        t,
    ])
}
