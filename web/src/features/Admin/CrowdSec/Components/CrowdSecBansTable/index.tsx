import useCrowdSecBansTableLogic from './Hooks/useCrowdSecBansTableLogic.ts'
import type { CrowdSecBansTableProps } from './Types/crowdsec-bans-table.types.ts'
import { SearchInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { Info, Search } from 'lucide-react'

import { TOOLTIP_DEFAULT_PROPS } from '@/config/tooltip.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import CountryFlag from '@/shared/Components/CountryFlag.tsx'
import TableBodyState from '@/shared/Table/Components/TableBodyState.tsx'
import TableFilters from '@/shared/Table/Components/TableFilters.tsx'
import TableFilterToggle from '@/shared/Table/Components/TableFilterToggle.tsx'
import TableLayout from '@/shared/Table/Components/TableLayout.tsx'
import TableLoadingBody from '@/shared/Table/Components/TableLoadingBody.tsx'
import RemoteTablePagination from '@/shared/Table/Components/RemoteTablePagination.tsx'
import { scenarioDescriptionKey } from '@/lib/Admin/CrowdSec/scenarioDescription.ts'

export default function CrowdSecBansTable(props: CrowdSecBansTableProps) {
    const {
        decisions,
        filters,
        isLoading,
        onSearchChange,
        onOriginChange,
        onScopeChange,
        onPageChange,
        onPageSizeChange,
    } = props
    const { t } = useTranslationStore()
    const { state, handler } = useCrowdSecBansTableLogic(props)
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
                    contentId={state.contentId}
                    expanded={state.open}
                    onToggle={handler.handleToggleFilters}
                    activeCount={state.activeFilterCount}
                />
            }
            filters={
                <TableFilters
                    contentId={state.contentId}
                    expanded={state.open}
                    activeCount={state.activeFilterCount}
                >
                    {() => (
                        <div className="grid items-end gap-4 sm:grid-cols-2">
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                {t('admin.crowdSec.dashboard.origin')}
                                <CustomSelect
                                    aria-label={t('admin.crowdSec.dashboard.origin')}
                                    value={filters.origin}
                                    placeholder={t('admin.crowdSec.dashboard.allOrigins')}
                                    options={state.scopeOptions}
                                    onValueChange={onOriginChange}
                                    searchable
                                />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold text-muted">
                                {t('admin.crowdSec.dashboard.scope')}
                                <CustomSelect
                                    aria-label={t('admin.crowdSec.dashboard.scope')}
                                    value={filters.scope}
                                    placeholder={t('admin.crowdSec.dashboard.allScopes')}
                                    options={state.originOptions}
                                    onValueChange={(value) =>
                                        onScopeChange(
                                            value === 'Ip' || value === 'Range' ? value : '',
                                        )
                                    }
                                    searchable={false}
                                />
                            </label>
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
                                    description: state.hasFilters
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
                                                    className="rounded text-muted hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
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
