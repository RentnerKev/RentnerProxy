import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'
import useClientTableLogic, {
    type ClientTableFeatures,
} from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import type { CertificateTableProps } from '../Types/certificate-management.types'
import useCertificatesTableColumns from './useCertificatesTableColumns'

type Translate = ReturnType<typeof useTranslationStore>['t']

const getCertificateRowId = (certificate: CertificateSummary) => certificate.id

const createCertificateGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, CertificateSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const certificate = row.original
        const status = t(`admin.certificates.status.${certificate.status}`)
        const source = t(`admin.certificates.source.${certificate.source}`)
        return [
            certificate.name,
            ...certificate.domains,
            certificate.source,
            source,
            certificate.status,
            status,
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

export default function useCertificatesTableLogic(props: CertificateTableProps) {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.certificates], [props.certificates])
    const columns = useCertificatesTableColumns(props)
    const table = useClientTableLogic({
        data,
        columns,
        getRowId: getCertificateRowId,
        initialSorting: [{ id: 'expiresAt', desc: false }],
        globalFilterFn: useMemo(() => createCertificateGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo(
        () => ({
            source: {
                type: 'select' as const,
                placeholder: t('admin.certificates.filters.allSources'),
                options: [
                    { label: t('admin.certificates.source.manual'), value: 'manual' },
                    { label: t('admin.certificates.source.acme'), value: 'acme' },
                ],
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
        [t],
    )
    return {
        state: { ...table.state, columnFilterConfigs, showColumnFilters },
        handler: {
            ...table.handler,
            toggleColumnFilters: () => setShowColumnFilters((value) => !value),
        },
    }
}
