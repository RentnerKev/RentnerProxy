import { createElement, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import {
    DdnsNameCell,
    DdnsConnectionCell,
    DdnsProxyCell,
    DdnsProxyBadge,
    DdnsStatusCell,
    DdnsScheduleCell,
    DdnsActionsCell,
} from '../Components/DdnsRecordCells.tsx'
import type {
    DdnsRecordsProps,
    DdnsRecordRow,
    DdnsRecordsLogicResult,
} from '../Types/ddns-table.types.ts'

const getRowId = (row: DdnsRecordRow) => row.target.id
const recordFilterStatuses = [
    'notAttempted',
    'running',
    'updated',
    'unchanged',
    'failed',
    'attention',
    'targetPaused',
    'familyPaused',
    'disabled',
    'skipped',
] as const
export default function useDdnsRecordsLogic({
    rows,
    canManage,
    locked,
    onEdit,
    onToggle,
    onDelete,
}: DdnsRecordsProps): DdnsRecordsLogicResult {
    const { t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, DdnsRecordRow>>>(
        () => [
            {
                id: 'name',
                accessorFn: (row) => `${row.target.name} ${row.target.recordType}`,
                header: t('admin.ddns.table.name'),
                sortFn: 'text',
                filterFn: 'includesString',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsNameCell, { row: row.original }),
            },
            {
                id: 'connection',
                accessorFn: (row) => `${row.connectionLabel} ${row.zone}`,
                header: t('admin.ddns.table.connection'),
                sortFn: 'text',
                filterFn: 'includesString',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsConnectionCell, { row: row.original }),
            },
            {
                id: 'proxy',
                accessorFn: (row) =>
                    t(row.target.proxied ? 'admin.ddns.table.proxied' : 'admin.ddns.table.dnsOnly'),
                header: t('admin.ddns.table.proxy'),
                sortFn: 'text',
                filterFn: (row, _id, value) =>
                    row.original.target.proxied === (value === 'proxied'),
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsProxyCell, { row: row.original }),
            },
            {
                id: 'status',
                accessorFn: (row) => `${t(`admin.ddns.results.${row.statusKey}`)} ${row.address}`,
                header: t('admin.ddns.table.status'),
                sortFn: 'text',
                filterFn: (row, _id, value) => row.original.statusKey === value,
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsStatusCell, { row: row.original }),
            },
            {
                id: 'schedule',
                header: t('admin.ddns.table.schedule'),
                enableSorting: false,
                enableGlobalFilter: false,
                enableColumnFilter: false,
                cell: ({ row }) => createElement(DdnsScheduleCell, { row: row.original }),
            },
            ...(canManage
                ? [
                      {
                          id: 'actions',
                          header: t('admin.ddns.table.actions'),
                          enableSorting: false,
                          enableGlobalFilter: false,
                          enableColumnFilter: false,
                          cell: ({ row }) =>
                              createElement(DdnsActionsCell, {
                                  row: row.original,
                                  canManage,
                                  locked,
                                  onEdit,
                                  onToggle,
                                  onDelete,
                              }),
                      } satisfies ColumnDef<ClientTableFeatures, DdnsRecordRow>,
                  ]
                : []),
        ],
        [t, canManage, locked, onEdit, onToggle, onDelete],
    )
    const { state, handler, table } = useClientTable({
        data: rows,
        columns,
        getRowId,
        initialSorting: [{ id: 'name', desc: false }],
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            name: {
                type: 'text',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.ddns.table.name'),
                }),
            },
            connection: {
                type: 'text',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.ddns.table.connection'),
                }),
            },
            proxy: {
                type: 'select',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.ddns.table.proxy'),
                }),
                options: [
                    {
                        value: 'proxied',
                        label: t('admin.ddns.table.proxied'),
                        content: createElement(DdnsProxyBadge, { proxied: true }),
                    },
                    {
                        value: 'dnsOnly',
                        label: t('admin.ddns.table.dnsOnly'),
                        content: createElement(DdnsProxyBadge, { proxied: false }),
                    },
                ],
            },
            status: {
                type: 'select',
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.ddns.table.status'),
                }),
                options: recordFilterStatuses.map((value) => ({
                    value,
                    label: t(`admin.ddns.results.${value}`),
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
