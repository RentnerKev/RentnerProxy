import type { CrowdSecBansTableLogicResult } from '../Types/crowdsec-bans-table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTableFilters from '@/shared/Table/Hooks/useTableFilters.ts'
import type { CrowdSecBansTableProps } from '../Types/crowdsec-bans-table.types.ts'
import { countries } from 'country-flag-icons'
import { useMemo } from 'react'

export default function useCrowdSecBansTableLogic({
    filters,
    origins,
}: CrowdSecBansTableProps): CrowdSecBansTableLogicResult {
    const { t, locale } = useTranslationStore()
    const filterPanel = useTableFilters()
    const activeFilterCount =
        Number(filters.origin !== '') +
        Number(filters.scope !== '') +
        Number(filters.country !== '') +
        Number(filters.searchInput.trim().length > 0)
    const hasFilters = activeFilterCount > 0
    const countryOptions = useMemo(() => {
        const names = new Intl.DisplayNames([locale], { type: 'region' })
        return countries
            .filter((code) => /^[A-Z]{2}$/u.test(code))
            .map((code) => ({ value: code, label: names.of(code) ?? code }))
            .toSorted((left, right) => left.label.localeCompare(right.label, locale))
    }, [locale])

    return {
        state: {
            contentId: filterPanel.contentId,
            open: filterPanel.open,
            activeFilterCount,
            hasFilters,
            countryOptions: [
                { value: '', label: t('admin.crowdSec.dashboard.allCountries') },
                ...countryOptions,
            ],
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
