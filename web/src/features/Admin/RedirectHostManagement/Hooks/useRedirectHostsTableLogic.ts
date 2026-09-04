import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'
import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { RedirectHostSummary } from '../../../../shared/Types/redirect-hosts.types'
import type { RedirectHostsTableProps } from '../Types/redirect-host-table.types'
import useRedirectHostsTableColumns from './useRedirectHostsTableColumns'
const getRowId = (host: RedirectHostSummary) => host.id
const globalFilter =
    (
        t: ReturnType<typeof useTranslationStore>['t'],
        locale: string,
    ): FilterFn<ClientTableFeatures, RedirectHostSummary> =>
    (row, _id, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const host = row.original
        const status = host.enabled ? 'enabled' : 'disabled'
        return [
            ...host.domains,
            host.destination,
            String(host.statusCode),
            t('admin.redirectHosts.status.' + status),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }
export default function useRedirectHostsTableLogic(props: RedirectHostsTableProps) {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useRedirectHostsTableColumns(props)
    const tableLogic = useClientTableLogic({
        data: useMemo(() => [...props.redirectHosts], [props.redirectHosts]),
        columns,
        getRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => globalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            domains: {
                type: 'text',
                placeholder: t('admin.redirectHosts.filters.domains'),
                maxLength: 254,
            },
            statusCode: {
                type: 'select',
                placeholder: t('admin.redirectHosts.filters.allStatusCodes'),
                options: [301, 302, 307, 308].map((code) => ({
                    label: t('admin.redirectHosts.statusCodes.' + code),
                    value: String(code),
                })),
            },
            status: {
                type: 'select',
                placeholder: t('admin.redirectHosts.filters.allStatuses'),
                options: [
                    { label: t('admin.redirectHosts.status.enabled'), value: 'enabled' },
                    { label: t('admin.redirectHosts.status.disabled'), value: 'disabled' },
                ],
            },
            createdAt: {
                type: 'dateRange',
                fromLabel: t('admin.redirectHosts.filters.createdFrom'),
                toLabel: t('admin.redirectHosts.filters.createdTo'),
            },
        }),
        [t],
    )
    return {
        state: { ...tableLogic.state, columnFilterConfigs, showColumnFilters },
        handler: {
            ...tableLogic.handler,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
