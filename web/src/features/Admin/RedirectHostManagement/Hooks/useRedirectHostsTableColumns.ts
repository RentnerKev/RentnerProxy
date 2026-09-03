import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '../../../../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { RedirectHostSummary } from '../../../../shared/Types/redirect-hosts.types'
import RedirectHostTableActions from '../Components/RedirectHostTableActions'
import {
    RedirectHostCertificateCell,
    RedirectHostCreatedAtCell,
    RedirectHostDestinationCell,
    RedirectHostDomainsCell,
    RedirectHostStatusCell,
} from '../Components/RedirectHostTableCells'
import type { RedirectHostTableActionProps } from '../Types/redirect-host-table.types'
const textFilter = createTrimmedIncludesStringFilter<RedirectHostSummary>()
const dateFilter = createDateRangeFilter<RedirectHostSummary>()
export default function useRedirectHostsTableColumns(props: RedirectHostTableActionProps) {
    const { t } = useTranslationStore()
    return useMemo<Array<ColumnDef<ClientTableFeatures, RedirectHostSummary>>>(() => {
        const columns: Array<ColumnDef<ClientTableFeatures, RedirectHostSummary>> = [
            {
                id: 'domains',
                accessorFn: (host) => host.domains.join(' '),
                header: t('admin.redirectHosts.columns.domains'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RedirectHostDomainsCell, { domains: row.original.domains }),
            },
            {
                id: 'destination',
                accessorFn: (host) => host.destination,
                header: t('admin.redirectHosts.columns.destination'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RedirectHostDestinationCell, {
                        destination: row.original.destination,
                        statusCode: row.original.statusCode,
                        preserveRequestUri: row.original.preserveRequestUri,
                        certificateId: row.original.certificateId,
                    }),
            },
            {
                id: 'statusCode',
                accessorFn: (host) => String(host.statusCode),
                header: t('admin.redirectHosts.columns.statusCode'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) => t('admin.redirectHosts.statusCodes.' + row.original.statusCode),
            },
            {
                id: 'certificate',
                accessorFn: (host) => (host.certificateId ? 'https' : 'http'),
                header: t('admin.redirectHosts.columns.certificate'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RedirectHostCertificateCell, {
                        certificateId: row.original.certificateId,
                    }),
            },
            {
                id: 'status',
                accessorFn: (host) => (host.enabled ? 'enabled' : 'disabled'),
                header: t('admin.redirectHosts.columns.status'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RedirectHostStatusCell, { enabled: row.original.enabled }),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.redirectHosts.columns.created'),
                sortFn: sortFn_datetime,
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RedirectHostCreatedAtCell, { value: getValue() }),
            },
        ]
        if (props.canUpdate || props.canDelete || props.canEnable || props.canDisable)
            columns.push({
                id: 'actions',
                header: t('admin.redirectHosts.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(RedirectHostTableActions, { ...props, host: row.original }),
            })
        return columns
    }, [props, t])
}
