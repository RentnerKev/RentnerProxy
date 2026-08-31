import { sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo, useState } from 'react'
import useTranslationStore, { useDateFormatter } from '../../../../language/useTranslationStore'
import useClientTableLogic, {
    type ClientTableFeatures,
} from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { TrustedCaSummary } from '../../../../shared/Types/trusted-cas.types'
import TrustedCaTableActions from '../Components/TrustedCaTableActions'
import type { TrustedCaTableProps } from '../Types/trusted-ca-management.types'

const getTrustedCaRowId = (trustedCa: TrustedCaSummary) => trustedCa.id

export default function useTrustedCasTableLogic(props: TrustedCaTableProps) {
    const { t } = useTranslationStore()
    const formatDate = useDateFormatter()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.trustedCas], [props.trustedCas])
    const { canDelete, canUpdate, isPending, onDelete, onReplace } = props
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, TrustedCaSummary>>>(
        () => [
            {
                accessorKey: 'name',
                header: t('admin.trustedCas.columns.name'),
                sortFn: 'text',
                enableGlobalFilter: true,
            },
            ...(['subject', 'issuer'] as const).map((key) => ({
                accessorKey: key,
                header: t('admin.trustedCas.columns.' + key),
                sortFn: 'text' as const,
                enableGlobalFilter: true,
                cell: ({ row }: { row: { original: TrustedCaSummary } }) =>
                    createElement(
                        'span',
                        {
                            className: 'block max-w-60 break-words text-xs text-muted',
                            title: row.original[key],
                        },
                        row.original[key],
                    ),
            })),
            {
                accessorKey: 'fingerprintSha256',
                header: t('admin.trustedCas.columns.fingerprint'),
                enableSorting: false,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(
                        'span',
                        {
                            className:
                                'block max-w-60 break-all font-mono text-[0.65rem] text-muted',
                        },
                        row.original.fingerprintSha256,
                    ),
            },
            {
                accessorKey: 'notAfter',
                header: t('admin.trustedCas.columns.expires'),
                sortFn: sortFn_datetime,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(
                        'span',
                        { className: 'whitespace-nowrap text-muted' },
                        formatDate.format(row.original.notAfter),
                    ),
            },
            ...(canUpdate || canDelete
                ? [
                      {
                          id: 'actions',
                          header: t('admin.trustedCas.columns.actions'),
                          enableSorting: false,
                          enableColumnFilter: false,
                          enableGlobalFilter: false,
                          cell: ({ row }: { row: { original: TrustedCaSummary } }) =>
                              createElement(TrustedCaTableActions, {
                                  trustedCa: row.original,
                                  canDelete,
                                  canUpdate,
                                  isPending,
                                  onDelete,
                                  onReplace,
                              }),
                      },
                  ]
                : []),
        ],
        [canDelete, canUpdate, formatDate, isPending, onDelete, onReplace, t],
    )
    const table = useClientTableLogic({
        data,
        columns,
        getRowId: getTrustedCaRowId,
        initialSorting: [{ id: 'notAfter', desc: false }],
    })
    return {
        state: { ...table.state, showColumnFilters },
        handler: {
            ...table.handler,
            toggleColumnFilters: () => setShowColumnFilters((value) => !value),
        },
    }
}
