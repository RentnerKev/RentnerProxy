import { createElement, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    DdnsNameCell,
    DdnsConnectionCell,
    DdnsProxyCell,
    DdnsStatusCell,
    DdnsScheduleCell,
    DdnsActionsCell,
} from '../Components/DdnsRecordCells.tsx'
import type { DdnsRecordsProps, DdnsRecordRow } from '../Types/ddns-table.types.ts'

const getRowId = (row: DdnsRecordRow) => row.target.id
const noFilters = () => {}
export default function useDdnsRecordsLogic({
    rows,
    canManage,
    locked,
    onEdit,
    onToggle,
    onDelete,
}: DdnsRecordsProps) {
    const { t } = useTranslationStore()
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, DdnsRecordRow>>>(
        () => [
            {
                id: 'name',
                accessorFn: (row) => `${row.target.name} ${row.target.recordType}`,
                header: t('admin.ddns.table.name'),
                sortFn: 'text',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsNameCell, { row: row.original }),
            },
            {
                id: 'connection',
                accessorFn: (row) => `${row.connectionLabel} ${row.zone}`,
                header: t('admin.ddns.table.connection'),
                sortFn: 'text',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsConnectionCell, { row: row.original }),
            },
            {
                id: 'proxy',
                accessorFn: (row) =>
                    t(row.target.proxied ? 'admin.ddns.table.proxied' : 'admin.ddns.table.dnsOnly'),
                header: t('admin.ddns.table.proxy'),
                sortFn: 'text',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsProxyCell, { row: row.original }),
            },
            {
                id: 'status',
                accessorFn: (row) => `${t(`admin.ddns.results.${row.statusKey}`)} ${row.address}`,
                header: t('admin.ddns.table.status'),
                sortFn: 'text',
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(DdnsStatusCell, { row: row.original }),
            },
            {
                id: 'schedule',
                header: t('admin.ddns.table.schedule'),
                enableSorting: false,
                enableGlobalFilter: false,
                cell: ({ row }) => createElement(DdnsScheduleCell, { row: row.original }),
            },
            ...(canManage
                ? [
                      {
                          id: 'actions',
                          header: t('admin.ddns.table.actions'),
                          enableSorting: false,
                          enableGlobalFilter: false,
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
    return { state, table, handler: { ...handler, noFilters } }
}
