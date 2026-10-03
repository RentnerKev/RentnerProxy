import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import { createDateRangeFilter } from '@/lib/Table/tableFilters.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { CertificateTableProps } from '../Types/certificates-table.types.ts'
import CertificateTableActions from '../Components/CertificateTableActions.tsx'
import {
    CertificateDateCell,
    CertificateDomainsCell,
    CertificateOperationCell,
    CertificateSourceCell,
    CertificateStatusCell,
} from '../Components/CertificateTableCells.tsx'
import { getCertificateOperationSearchValues } from '@/lib/Admin/CertificateManagement/certificateOperations.ts'

const expiryFilter = createDateRangeFilter<CertificateSummary>()

export default function useCertificatesTableColumns(actions: CertificateTableProps) {
    const { t } = useTranslationStore()
    return useMemo<Array<ColumnDef<ClientTableFeatures, CertificateSummary>>>(
        () => [
            {
                accessorKey: 'name',
                header: t('admin.certificates.columns.name'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
            },
            {
                id: 'domains',
                accessorFn: (certificate) => certificate.domains.join(' '),
                header: t('admin.certificates.columns.domains'),
                sortFn: 'text',
                filterFn: (row, _columnId, value) => row.original.domains.includes(String(value)),
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(CertificateDomainsCell, { domains: row.original.domains }),
            },
            {
                accessorKey: 'source',
                header: t('admin.certificates.columns.source'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(CertificateSourceCell, { source: row.original.source }),
            },
            {
                accessorKey: 'status',
                header: t('admin.certificates.columns.status'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(CertificateStatusCell, {
                        candidate: row.original.candidate !== null,
                        status: row.original.status,
                    }),
            },
            {
                id: 'operation',
                accessorFn: (certificate) =>
                    getCertificateOperationSearchValues(certificate).join(' '),
                header: t('admin.certificates.columns.operation'),
                sortFn: 'text',
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(CertificateOperationCell, { certificate: row.original }),
            },
            {
                accessorKey: 'expiresAt',
                header: t('admin.certificates.columns.expires'),
                sortFn: sortFn_datetime,
                filterFn: expiryFilter,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(CertificateDateCell, { value: row.original.expiresAt }),
            },
            {
                id: 'actions',
                header: t('admin.certificates.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(CertificateTableActions, {
                        ...actions,
                        certificate: row.original,
                    }),
            },
        ],
        [actions, t],
    )
}
