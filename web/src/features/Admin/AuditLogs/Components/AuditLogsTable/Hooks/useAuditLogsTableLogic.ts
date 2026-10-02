import type { AuditLogsTableLogicResult } from '../Types/audit-logs-table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTableFilters from '@/shared/Table/Hooks/useTableFilters.ts'
import type { AuditLogsTableProps } from '../Types/audit-logs-table.types.ts'
import { auditActionValues, auditResourceValues } from '@/lib/Admin/AuditLogs/auditLogs.ts'

export default function useAuditLogsTableLogic({
    filters,
    actorOptions,
}: AuditLogsTableProps): AuditLogsTableLogicResult {
    const { t } = useTranslationStore()
    const filterPanel = useTableFilters()
    const activeFilterCount = [
        filters.actorUserId.trim(),
        filters.action,
        filters.resource,
        filters.from,
        filters.to,
    ].filter((value) => value.length > 0).length
    const hasActiveFilters = activeFilterCount > 0

    return {
        state: {
            contentId: filterPanel.contentId,
            open: filterPanel.open,
            activeFilterCount,
            hasActiveFilters,
            resourceOptions: [
                {
                    label: t('admin.auditLogs.filters.allResources'),
                    value: '',
                },
                ...auditResourceValues.map((resource) => ({
                    label: t(`admin.auditLogs.values.resources.${resource}`),
                    value: resource,
                })),
            ],
            actionOptions: [
                {
                    label: t('admin.auditLogs.filters.allActions'),
                    value: '',
                },
                ...auditActionValues.map((action) => ({
                    label: t(`admin.auditLogs.values.actions.${action}`),
                    value: action,
                })),
            ],
            actorOptions: [
                {
                    label: t('admin.auditLogs.filters.actorPlaceholder'),
                    value: '',
                },
                ...actorOptions.map((option) => ({
                    label: option.displayName,
                    value: option.id,
                })),
            ],
        },
        handler: { handleToggleFilters: filterPanel.toggle },
    }
}
