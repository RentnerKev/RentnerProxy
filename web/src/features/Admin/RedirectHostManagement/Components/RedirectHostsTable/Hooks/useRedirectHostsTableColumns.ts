import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import RedirectHostTableActions from '../Components/RedirectHostTableActions.tsx'
import HostTagsCell from '@/features/Admin/HostTags/Components/HostTagsCell.tsx'
import {
    RedirectHostCertificateCell,
    RedirectHostCreatedAtCell,
    RedirectHostDestinationCell,
    RedirectHostDomainsCell,
    RedirectHostStatusCell,
} from '../Components/RedirectHostTableCells.tsx'
import type { RedirectHostTableActionProps } from '../../../Types/redirect-host-table.types.ts'
const textFilter = createTrimmedIncludesStringFilter<RedirectHostSummary>()
const dateFilter = createDateRangeFilter<RedirectHostSummary>()
export default function useRedirectHostsTableColumns(props: RedirectHostTableActionProps) {
    const { t } = useTranslationStore()
    // Preserve the stateful tag cell when unrelated row actions refresh.
    const tagsColumn = useMemo<ColumnDef<ClientTableFeatures, RedirectHostSummary>>(
        () => ({
            id: 'tags',
            accessorFn: (host) => (host.tags ?? []).map((tag) => tag.name).join(' '),
            header: t('admin.hostTags.title'),
            sortFn: 'text',
            filterFn: (row, _id, value) =>
                value === 'untagged'
                    ? !row.original.tags?.length
                    : Boolean(row.original.tags?.some((tag) => tag.id === value)),
            cell: ({ row }) =>
                createElement(HostTagsCell, {
                    kind: 'redirect',
                    hostId: row.original.id,
                    hostLabel: row.original.domains[0] ?? row.original.destination,
                    tags: row.original.tags,
                    canManage: props.canUpdate && !props.isPending,
                }),
        }),
        [props.canUpdate, props.isPending, t],
    )
    return useMemo<Array<ColumnDef<ClientTableFeatures, RedirectHostSummary>>>(() => {
        const columns: Array<ColumnDef<ClientTableFeatures, RedirectHostSummary>> = [
            {
                id: 'domains',
                accessorFn: (host) => host.domains.join(' '),
                header: t('admin.redirectHosts.columns.domains'),
                sortFn: 'text',
                filterFn: (row, _columnId, value) => row.original.domains.includes(String(value)),
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RedirectHostDomainsCell, { domains: row.original.domains }),
            },
            tagsColumn,
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
        if (
            props.canUpdate ||
            props.canDelete ||
            props.canEnable ||
            props.canDisable ||
            (props.canDuplicate && props.onDuplicate)
        )
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
    }, [props, tagsColumn, t])
}
