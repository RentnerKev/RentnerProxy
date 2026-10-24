import { createElement, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { DiscoveryRow } from '@/lib/DockerDiscovery/Types/management.types.ts'
import { formatProxyHostForward } from '@/lib/Admin/ProxyHostManagement/proxyHostTableCells.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    DiscoverySourceCell,
    DiscoveryDomainsCell,
    DiscoveryTargetCell,
    DiscoveryStatusCell,
    DiscoveryActionsCell,
} from '../Components/DiscoveryCells.tsx'
import type {
    DiscoveryTableProps,
    DiscoveryTableLogicResult,
} from '../../../Types/discovery-ui.types.ts'

const getRowId = (row: DiscoveryRow) => `${row.key}:${row.containerId ?? ''}`
const states = [
    'create',
    'update',
    'current',
    'stopped',
    'orphaned',
    'conflicted',
    'unavailable',
    'detached',
] as const
export default function useDiscoveryTableLogic(
    props: DiscoveryTableProps,
): DiscoveryTableLogicResult {
    const { t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.rows], [props.rows])
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, DiscoveryRow>>>(
        () => [
            {
                id: 'source',
                accessorFn: (row) => `${row.sourceId} ${row.containerId ?? ''}`,
                header: t('admin.dockerDiscovery.table.source'),
                sortFn: 'text',
                filterFn: 'includesString',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DiscoverySourceCell, { row: row.original }),
            },
            {
                id: 'domains',
                accessorFn: (row) => row.domains.join(' '),
                header: t('admin.dockerDiscovery.table.domains'),
                sortFn: 'text',
                filterFn: 'includesString',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DiscoveryDomainsCell, { row: row.original }),
            },
            {
                id: 'target',
                accessorFn: (row) =>
                    row.target
                        ? `${formatProxyHostForward(row.target.scheme, row.target.address, row.target.port)} ${row.target.network}`
                        : '',
                header: t('admin.dockerDiscovery.table.target'),
                sortFn: 'text',
                filterFn: 'includesString',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DiscoveryTargetCell, { row: row.original }),
            },
            {
                id: 'status',
                accessorFn: (row) => t(`admin.dockerDiscovery.states.${row.state}`),
                header: t('admin.dockerDiscovery.table.status'),
                sortFn: 'text',
                filterFn: (row, _id, value) => row.original.state === value,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(DiscoveryStatusCell, {
                        row: {
                            ...row.original,
                            issues: row.original.issues.filter(
                                (issue) => issue !== 'reconcile_failed',
                            ),
                        },
                    }),
            },
            {
                id: 'actions',
                header: t('admin.dockerDiscovery.table.actions'),
                enableSorting: false,
                enableGlobalFilter: false,
                enableColumnFilter: false,
                cell: ({ row }) =>
                    createElement(DiscoveryActionsCell, {
                        row: row.original,
                        canDetach: props.canDetach,
                        locked: props.locked,
                        onDetails: props.onDetails,
                        onDetach: props.onDetach,
                    }),
            },
        ],
        [t, props.canDetach, props.locked, props.onDetails, props.onDetach],
    )
    const { table, state, handler } = useClientTable({
        data,
        columns,
        getRowId,
        initialSorting: [{ id: 'source', desc: false }],
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            source: {
                type: 'text',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.dockerDiscovery.table.source'),
                }),
            },
            domains: {
                type: 'text',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.dockerDiscovery.table.domains'),
                }),
            },
            target: {
                type: 'text',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.dockerDiscovery.table.target'),
                }),
            },
            status: {
                type: 'select',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.dockerDiscovery.table.status'),
                }),
                options: states.map((value) => ({
                    value,
                    label: t(`admin.dockerDiscovery.states.${value}`),
                })),
            },
        }),
        [t],
    )
    return {
        table,
        state: { searchInput: state.searchInput, showColumnFilters, columnFilterConfigs },
        handler: {
            handleSearchInputChange: handler.handleSearchInputChange,
            handleResetFilters: handler.handleResetFilters,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
