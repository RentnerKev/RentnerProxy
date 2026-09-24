import { SearchInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { Info, Search } from 'lucide-react'

import { TOOLTIP_DEFAULT_PROPS } from '../../../../config/tooltip.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import CountryFlag from '../../../../shared/Components/CountryFlag'
import TableBodyState from '../../../../shared/Table/Components/TableBodyState'
import TableFilters from '../../../../shared/Table/Components/TableFilters'
import TableFilterToggle from '../../../../shared/Table/Components/TableFilterToggle'
import TableLayout from '../../../../shared/Table/Components/TableLayout'
import TableLoadingBody from '../../../../shared/Table/Components/TableLoadingBody'
import RemoteTablePagination from '../../../../shared/Table/Components/RemoteTablePagination'
import useTableFilters from '../../../../shared/Table/Hooks/useTableFilters'
import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '../../../../shared/Types/crowdsec.types'
import { scenarioDescriptionKey } from '../Helpers/scenarioDescription'

interface Props {
    readonly decisions: CrowdSecDashboard['decisions']
    readonly origins: readonly string[]
    readonly filters: {
        readonly searchInput: string
        readonly origin: string
        readonly scope: CrowdSecDashboardQuery['scope']
        readonly pageIndex: number
        readonly pageSize: number
    }
    readonly isLoading: boolean
    readonly onSearchChange: (value: string) => void
    readonly onOriginChange: (value: string) => void
    readonly onScopeChange: (value: CrowdSecDashboardQuery['scope']) => void
    readonly onPageChange: (page: number) => void
    readonly onPageSizeChange: (size: number) => void
    readonly onReset: () => void
}

export default function CrowdSecBansTable({
    decisions,
    origins,
    filters,
    isLoading,
    onSearchChange,
    onOriginChange,
    onScopeChange,
    onPageChange,
    onPageSizeChange,
    onReset,
}: Props) {
    const { t } = useTranslationStore()
    const filterPanel = useTableFilters()
    const activeFilterCount =
        Number(filters.origin !== '') +
        Number(filters.scope !== '') +
        Number(filters.searchInput.trim().length > 0)
    const hasFilters = activeFilterCount > 0
    return (
        <TableLayout
            titleId="crowdsec-bans-title"
            eyebrow={t('admin.crowdSec.dashboard.bansEyebrow')}
            title={t('admin.crowdSec.dashboard.banList')}
            description={t('admin.crowdSec.dashboard.banListHint')}
            toolbar={
                <label className="relative block min-w-0 sm:w-72">
                    <span className="sr-only">{t('admin.crowdSec.dashboard.search')}</span>
                    <SearchInput
                        type="search"
                        icon={<Search aria-hidden="true" className="size-4" />}
                        value={filters.searchInput}
                        maxLength={200}
                        placeholder={t('admin.crowdSec.dashboard.searchPlaceholder')}
                        onChange={(event) => onSearchChange(event.target.value)}
                    />
                </label>
            }
            filterToggle={
                <TableFilterToggle
                    contentId={filterPanel.contentId}
                    expanded={filterPanel.open}
                    onToggle={filterPanel.toggle}
                    activeCount={activeFilterCount}
                />
            }
            filters={
                <TableFilters
                    contentId={filterPanel.contentId}
                    expanded={filterPanel.open}
                    activeCount={activeFilterCount}
                    onReset={onReset}
                >
                    {(resetButton) => (
                        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                {t('admin.crowdSec.dashboard.origin')}
                                <CustomSelect
                                    aria-label={t('admin.crowdSec.dashboard.origin')}
                                    value={filters.origin}
                                    options={[
                                        {
                                            value: '',
                                            label: t('admin.crowdSec.dashboard.allOrigins'),
                                        },
                                        ...origins.map((origin) => ({
                                            value: origin,
                                            label: origin,
                                        })),
                                    ]}
                                    onValueChange={onOriginChange}
                                    searchable
                                />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                {t('admin.crowdSec.dashboard.scope')}
                                <CustomSelect
                                    aria-label={t('admin.crowdSec.dashboard.scope')}
                                    value={filters.scope}
                                    options={[
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
                                    ]}
                                    onValueChange={(value) =>
                                        onScopeChange(
                                            value === 'Ip' || value === 'Range' ? value : '',
                                        )
                                    }
                                    searchable={false}
                                />
                            </label>
                            <div>{resetButton}</div>
                        </div>
                    )}
                </TableFilters>
            }
            pagination={
                decisions ? (
                    <RemoteTablePagination
                        pageIndex={filters.pageIndex}
                        pageSize={filters.pageSize}
                        total={decisions.filteredTotal}
                        itemLabel={t('admin.crowdSec.dashboard.banItem')}
                        onPageChange={onPageChange}
                        onPageSizeChange={onPageSizeChange}
                        disabled={isLoading}
                    />
                ) : null
            }
        >
            <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] table-auto border-collapse">
                    <thead className="bg-surface-subtle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase">
                        <tr>
                            {(['address', 'remaining', 'origin', 'scope', 'scenario'] as const).map(
                                (column) => (
                                    <th
                                        key={column}
                                        scope="col"
                                        className="h-12 border-b border-border px-4 py-0 text-left"
                                    >
                                        {t(`admin.crowdSec.dashboard.${column}`)}
                                    </th>
                                ),
                            )}
                        </tr>
                    </thead>
                    {isLoading ? (
                        <TableLoadingBody
                            columnCount={5}
                            loadingLabel={t('admin.crowdSec.dashboard.banList')}
                        />
                    ) : null}
                    {!isLoading && !decisions ? (
                        <tbody>
                            <TableBodyState
                                columnCount={5}
                                state={{
                                    title: t('admin.crowdSec.dashboard.unavailable'),
                                    description: t('admin.crowdSec.dashboard.unavailable'),
                                }}
                            />
                        </tbody>
                    ) : null}
                    {!isLoading && decisions && decisions.entries.length === 0 ? (
                        <tbody>
                            <TableBodyState
                                columnCount={5}
                                state={{
                                    title: t('admin.crowdSec.dashboard.noBans'),
                                    description: hasFilters
                                        ? t('admin.crowdSec.dashboard.filteredEmpty')
                                        : t('admin.crowdSec.dashboard.noBans'),
                                }}
                            />
                        </tbody>
                    ) : null}
                    {!isLoading && decisions && decisions.entries.length > 0 ? (
                        <tbody>
                            {decisions.entries.map((decision) => (
                                <tr
                                    key={decision.id}
                                    className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover"
                                >
                                    <td className="px-4 py-[0.85rem] align-middle font-mono text-xs text-ink-soft">
                                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                            {decision.value}
                                            <CountryFlag code={decision.countryCode} />
                                        </span>
                                    </td>
                                    <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft tabular-nums">
                                        {decision.duration}
                                    </td>
                                    <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-muted">
                                        {decision.origin}
                                    </td>
                                    <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-muted">
                                        {t(
                                            `admin.crowdSec.dashboard.${decision.scope === 'Ip' ? 'ipScope' : 'rangeScope'}`,
                                        )}
                                    </td>
                                    <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-muted">
                                        <span className="inline-flex items-center gap-2">
                                            <CustomTooltip
                                                {...TOOLTIP_DEFAULT_PROPS}
                                                content={decision.scenario}
                                            >
                                                <span
                                                    className="max-w-52 truncate"
                                                    aria-label={decision.scenario}
                                                >
                                                    {decision.scenario}
                                                </span>
                                            </CustomTooltip>
                                            <CustomTooltip
                                                {...TOOLTIP_DEFAULT_PROPS}
                                                content={t(
                                                    `admin.crowdSec.dashboard.scenarioDescriptions.${scenarioDescriptionKey(decision.scenario)}`,
                                                )}
                                            >
                                                <button
                                                    type="button"
                                                    className="rounded text-muted hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                                    aria-label={t(
                                                        'admin.crowdSec.dashboard.scenarioInfo',
                                                        { scenario: decision.scenario },
                                                    )}
                                                >
                                                    <Info aria-hidden="true" className="size-3.5" />
                                                </button>
                                            </CustomTooltip>
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    ) : null}
                </table>
            </div>
        </TableLayout>
    )
}
