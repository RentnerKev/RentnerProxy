import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'
import type { ProxyHostsTableProps } from '../Types/proxy-host-table.types'
import useProxyHostsTableColumns from './useProxyHostsTableColumns'

type Translate = ReturnType<typeof useTranslationStore>['t']

const getProxyHostRowId = (host: ProxyHostSummary) => host.id

const createProxyHostGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, ProxyHostSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        const host = row.original

        if (!search) {
            return true
        }

        const status = host.enabled ? 'enabled' : 'disabled'

        return [
            ...host.domains,
            host.forwardScheme,
            t('admin.proxyHosts.scheme.' + host.forwardScheme),
            host.forwardHost,
            String(host.forwardPort),
            status,
            t('admin.proxyHosts.status.' + status),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

export default function useProxyHostsTableLogic(props: ProxyHostsTableProps) {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const data = useMemo(() => [...props.proxyHosts], [props.proxyHosts])
    const columns = useProxyHostsTableColumns(props)
    const tableLogic = useClientTableLogic({
        data,
        columns,
        getRowId: getProxyHostRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createProxyHostGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            domains: {
                type: 'text',
                placeholder: t('admin.proxyHosts.filters.domains'),
                maxLength: 254,
            },
            forward: {
                type: 'select',
                placeholder: t('admin.proxyHosts.filters.allSchemes'),
                options: [
                    { label: t('admin.proxyHosts.scheme.http'), value: 'http' },
                    { label: t('admin.proxyHosts.scheme.https'), value: 'https' },
                ],
            },
            status: {
                type: 'select',
                placeholder: t('admin.proxyHosts.filters.allStatuses'),
                options: [
                    { label: t('admin.proxyHosts.status.enabled'), value: 'enabled' },
                    { label: t('admin.proxyHosts.status.disabled'), value: 'disabled' },
                ],
            },
            createdAt: {
                type: 'dateRange',
                fromLabel: t('admin.proxyHosts.filters.createdFrom'),
                toLabel: t('admin.proxyHosts.filters.createdTo'),
            },
        }),
        [t],
    )

    return {
        state: {
            ...tableLogic.state,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            ...tableLogic.handler,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
