import type { ProxyAccessLogsTableLogicResult } from '../Types/proxy-access-logs-table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTableFilters from '@/shared/Table/Hooks/useTableFilters.ts'
import type { ProxyAccessLogsTableProps } from '../Types/proxy-access-logs-table.types.ts'
import useProxyAccessLogsFilterOptions from './useProxyAccessLogsFilterOptions.ts'

export default function useProxyAccessLogsTableLogic({
    filters,
    availableHosts,
    availableStatuses,
    entries,
}: ProxyAccessLogsTableProps): ProxyAccessLogsTableLogicResult {
    const { t } = useTranslationStore()
    const filterPanel = useTableFilters()
    const { hostOptions, statusOptions } = useProxyAccessLogsFilterOptions({
        availableHosts,
        availableStatuses,
        entries,
    })
    const activeFilterCount = [
        filters.host.trim(),
        filters.status.trim(),
        filters.search.trim(),
    ].filter((value) => value.length > 0).length
    const hasActiveFilters = activeFilterCount > 0

    return {
        state: {
            contentId: filterPanel.contentId,
            open: filterPanel.open,
            activeFilterCount,
            hasActiveFilters,
            statusOptions: [
                {
                    label: t('admin.proxyAccessLogs.filters.allStatuses'),
                    value: '',
                },
                ...statusOptions.map((status) => ({
                    label: String(status),
                    value: String(status),
                })),
            ],
            hostOptions: [
                {
                    label: t('admin.proxyAccessLogs.filters.allHosts'),
                    value: '',
                },
                ...hostOptions.map((host) => ({
                    label: host,
                    value: host,
                })),
            ],
        },
        handler: { handleToggleFilters: filterPanel.toggle },
    }
}
