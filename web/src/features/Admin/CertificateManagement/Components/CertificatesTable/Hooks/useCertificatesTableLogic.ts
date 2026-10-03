import type { Translate } from '../Types/certificates-table-logic.types.ts'
import type { CertificatesTableLogicResult } from '../Types/certificates-table.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import { createSortedUniqueFilterOptions } from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { CertificateTableProps } from '../Types/certificates-table.types.ts'
import {
    getCertificateOperationDisplay,
    getCertificateOperationSearchValues,
} from '@/lib/Admin/CertificateManagement/certificateOperations.ts'
import useCertificatesTableColumns from './useCertificatesTableColumns.ts'

const getCertificateRowId = (certificate: CertificateSummary) => certificate.id

const createCertificateGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, CertificateSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const certificate = row.original
        const status = t(`admin.certificates.status.${certificate.status}`)
        const source = t(`admin.certificates.source.${certificate.source}`)
        const operation = getCertificateOperationDisplay(certificate)
        return [
            certificate.name,
            ...certificate.domains,
            certificate.source,
            source,
            certificate.status,
            status,
            ...getCertificateOperationSearchValues(certificate),
            ...(operation.stage
                ? [t(`admin.certificates.operationStages.${operation.stage}`)]
                : []),
            ...(operation.kind ? [t(`admin.certificates.operationKinds.${operation.kind}`)] : []),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

export default function useCertificatesTableLogic(
    props: CertificateTableProps,
): CertificatesTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.certificates], [props.certificates])
    const columns = useCertificatesTableColumns(props)
    const table = useClientTable({
        data,
        columns,
        getRowId: getCertificateRowId,
        initialSorting: [{ id: 'expiresAt', desc: false }],
        globalFilterFn: useMemo(() => createCertificateGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo(
        () => ({
            name: {
                type: 'searchableSelect' as const,
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.certificates.columns.name'),
                }),
                options: createSortedUniqueFilterOptions(
                    data.map((certificate) => certificate.name),
                ),
            },
            expiresAt: {
                type: 'dateRange' as const,
            },
            source: {
                type: 'select' as const,
                placeholder: t('admin.certificates.filters.allSources'),
                options: [
                    { label: t('admin.certificates.source.manual'), value: 'manual' },
                    { label: t('admin.certificates.source.acme'), value: 'acme' },
                ],
            },
            domains: {
                type: 'searchableSelect' as const,
                placeholder: t('table.filterColumnPlaceholder', {
                    column: t('admin.certificates.columns.domains'),
                }),
                options: createSortedUniqueFilterOptions(
                    data.flatMap((certificate) => certificate.domains),
                ),
            },
            status: {
                type: 'select' as const,
                placeholder: t('admin.certificates.filters.allStatuses'),
                options: ['pending', 'valid', 'expiring', 'expired', 'failed'].map((status) => ({
                    label: t(`admin.certificates.status.${status}`),
                    value: status,
                })),
            },
        }),
        [data, t],
    )
    return {
        table: table.table,
        state: { searchInput: table.state.searchInput, columnFilterConfigs, showColumnFilters },
        handler: {
            handleSearchInputChange: table.handler.handleSearchInputChange,
            handleResetFilters: table.handler.handleResetFilters,
            toggleColumnFilters: () => setShowColumnFilters((value) => !value),
        },
    }
}
