import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import type { CertificateTableProps } from '../Types/certificate-management.types'
import CertificateTableActions from '../Components/CertificateTableActions'
import {
    CertificateDateCell,
    CertificateDomainsCell,
    CertificateSourceCell,
    CertificateStatusCell,
} from '../Components/CertificateTableCells'

export default function useCertificatesTableColumns(actions: CertificateTableProps) {
    const { t } = useTranslationStore()
    return useMemo<Array<ColumnDef<ClientTableFeatures, CertificateSummary>>>(
        () => [
            {
                accessorKey: 'name',
                header: t('admin.certificates.columns.name'),
                sortFn: 'text',
                enableGlobalFilter: true,
            },
            {
                id: 'domains',
                accessorFn: (certificate) => certificate.domains.join(' '),
                header: t('admin.certificates.columns.domains'),
                sortFn: 'text',
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
                    createElement(CertificateStatusCell, { status: row.original.status }),
            },
            {
                accessorKey: 'expiresAt',
                header: t('admin.certificates.columns.expires'),
                sortFn: sortFn_datetime,
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
