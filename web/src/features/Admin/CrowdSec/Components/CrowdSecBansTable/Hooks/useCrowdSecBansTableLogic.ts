import type { CrowdSecBansTableLogicResult } from '../Types/crowdsec-bans-table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTableFilters from '@/shared/Table/Hooks/useTableFilters.ts'
import type { CrowdSecBansTableProps } from '../Types/crowdsec-bans-table.types.ts'

export default function useCrowdSecBansTableLogic({
    filters,
    origins,
}: CrowdSecBansTableProps): CrowdSecBansTableLogicResult {
    const { t } = useTranslationStore()
    const filterPanel = useTableFilters()
    const activeFilterCount =
        Number(filters.origin !== '') +
        Number(filters.scope !== '') +
        Number(filters.searchInput.trim().length > 0)
    const hasFilters = activeFilterCount > 0

    return {
        state: {
            contentId: filterPanel.contentId,
            open: filterPanel.open,
            activeFilterCount,
            hasFilters,
            scopeOptions: [
                {
                    value: '',
                    label: t('admin.crowdSec.dashboard.allScopes'),
                },
                {
                    value: 'Ip',
                    label: t('admin.crowdSec.dashboard.ipScope'),
                },
                {
                    value: 'Range',
                    label: t('admin.crowdSec.dashboard.rangeScope'),
                },
            ],
            originOptions: [
                {
                    value: '',
                    label: t('admin.crowdSec.dashboard.allOrigins'),
                },
                ...origins.map((origin) => ({
                    value: origin,
                    label: origin,
                })),
            ],
        },
        handler: { handleToggleFilters: filterPanel.toggle },
    }
}
