import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '../../../../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'
import ProxyHostTableActions from '../Components/ProxyHostTableActions'
import {
    ProxyHostCreatedAtCell,
    ProxyHostDomainsCell,
    ProxyHostForwardCell,
    ProxyHostStatusCell,
} from '../Components/ProxyHostTableCells'
import type { ProxyHostTableActionProps } from '../Types/proxy-host-table.types'

const textFilter = createTrimmedIncludesStringFilter<ProxyHostSummary>()
const dateFilter = createDateRangeFilter<ProxyHostSummary>()

export default function useProxyHostsTableColumns({
    canDelete,
    canDisable,
    canRequestCertificate,
    canEnable,
    canUpdate,
    isPending,
    onConfig,
    onDelete,
    onDisable,
    onEdit,
    onEnable,
    onRequestCertificate,
}: ProxyHostTableActionProps) {
    const { t } = useTranslationStore()

    return useMemo<Array<ColumnDef<ClientTableFeatures, ProxyHostSummary>>>(() => {
        const columns: Array<ColumnDef<ClientTableFeatures, ProxyHostSummary>> = [
            {
                id: 'domains',
                accessorFn: (host) => host.domains.join(' '),
                header: t('admin.proxyHosts.columns.domains'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(ProxyHostDomainsCell, { domains: row.original.domains }),
            },
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
                    createElement(ProxyHostStatusCell, { enabled: row.original.enabled }),
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

        if (
            canUpdate ||
            canDelete ||
            canEnable ||
            canDisable ||
            canRequestCertificate ||
            onConfig
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
                        host: row.original,
                        isPending,
                        ...(onConfig ? { onConfig } : {}),
                        onDelete,
                        onDisable,
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
        isPending,
        onConfig,
        onDelete,
        onDisable,
        onEdit,
        onEnable,
        onRequestCertificate,
        t,
    ])
}
