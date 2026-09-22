import { SearchInput } from '@rentnerkev/inputs'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { CustomSelect } from '@rentnerkev/select/select'
import { Fragment } from 'react'
import useProxyAccessLogsFilterOptions from '../Hooks/useProxyAccessLogsFilterOptions'

import { TOOLTIP_DEFAULT_PROPS } from '../../../../config/tooltip.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import TableBodyState from '../../../../shared/Table/Components/TableBodyState'
import TableFilters from '../../../../shared/Table/Components/TableFilters'
import TableFilterToggle from '../../../../shared/Table/Components/TableFilterToggle'
import useTableFilters from '../../../../shared/Table/Hooks/useTableFilters'
import TableLayout from '../../../../shared/Table/Components/TableLayout'
import TableLoadingBody from '../../../../shared/Table/Components/TableLoadingBody'
import RemoteTablePagination from '../../../../shared/Table/Components/RemoteTablePagination'
import { ActionMenu } from '../../../../shared/ActionMenu'
import type { ProxyAccessLogEntry } from '../../../../shared/Types/proxy-access-logs.types'
import {
    formatBytes,
    formatDuration,
    PROXY_ACCESS_LOGS_PAGE_SIZES,
    statusClassName,
    withoutQueryString,
} from '../Helpers/proxyAccessLogs'
import type { ProxyAccessLogsTableProps } from '../Types/proxy-access-logs.types'
import ClientIpCountry from './ClientIpCountry'

function logEntryKey(entry: ProxyAccessLogEntry, index: number): string {
    return `${entry.timestamp}-${entry.host}-${index}`
}

function LogDetails({ entry }: { readonly entry: ProxyAccessLogEntry }) {
    const { t } = useTranslationStore()
    return (
        <dl className="grid gap-2 text-xs text-muted sm:grid-cols-2">
            <div>
                <dt className="font-mono text-[0.65rem] tracking-[0.06em] text-muted-soft uppercase">
                    {t('admin.proxyAccessLogs.columns.upstream')}
                </dt>
                <dd className="mt-1 break-all font-mono text-ink-soft">
                    {entry.upstream ? withoutQueryString(entry.upstream) : '—'}
                </dd>
            </div>
            <div>
                <dt className="font-mono text-[0.65rem] tracking-[0.06em] text-muted-soft uppercase">
                    {t('admin.proxyAccessLogs.columns.protocol')}
                </dt>
                <dd className="mt-1 font-mono text-ink-soft">{entry.protocol || '—'}</dd>
            </div>
        </dl>
    )
}

export default function ProxyAccessLogsTable({
    entries,
    availableHosts,
    availableStatuses,
    expandedEntry,
    formatTimestamp,
    filters,
    filterErrors,
    total,
    truncated,
    snapshotReset,
    pageSize,
    currentPage,
    isLoading,
    onHostChange,
    onStatusChange,
    onSearchChange,
    onResetFilters,
    onPageChange,
    onPageSizeChange,
    onToggleDetails,
}: ProxyAccessLogsTableProps) {
    const { locale, t } = useTranslationStore()
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
    return (
        <TableLayout
            titleId="proxy-access-logs-table-title"
            eyebrow={t('admin.proxyAccessLogs.table.eyebrow')}
            title={t('admin.proxyAccessLogs.table.title')}
            description={t('admin.proxyAccessLogs.table.description')}
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
                    onReset={onResetFilters}
                >
                    {(resetButton) => (
                        <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="grid min-w-0 gap-1.5">
                                <span className="text-xs font-extrabold text-muted">
                                    {t('admin.proxyAccessLogs.filters.host')}
                                </span>
                                <CustomSelect
                                    id="proxy-log-host-filter"
                                    aria-label={t('admin.proxyAccessLogs.filters.host')}
                                    aria-describedby={
                                        filterErrors.host ? 'proxy-log-host-error' : undefined
                                    }
                                    aria-invalid={filterErrors.host !== undefined}
                                    messages={{
                                        noResults: t('admin.proxyAccessLogs.filters.noHosts'),
                                        searchPlaceholder: t(
                                            'admin.proxyAccessLogs.filters.hostSearchPlaceholder',
                                        ),
                                    }}
                                    onValueChange={onHostChange}
                                    options={[
                                        {
                                            label: t('admin.proxyAccessLogs.filters.allHosts'),
                                            value: '',
                                        },
                                        ...hostOptions.map((host) => ({
                                            label: host,
                                            value: host,
                                        })),
                                    ]}
                                    placeholder={t('admin.proxyAccessLogs.filters.hostPlaceholder')}
                                    searchable
                                    value={filters.host}
                                />
                                {filterErrors.host ? (
                                    <span
                                        id="proxy-log-host-error"
                                        role="alert"
                                        className="text-xs text-danger-text"
                                    >
                                        {t(filterErrors.host)}
                                    </span>
                                ) : null}
                            </div>
                            <label className="grid min-w-0 gap-1.5">
                                <span className="text-xs font-extrabold text-muted">
                                    {t('admin.proxyAccessLogs.filters.status')}
                                </span>
                                <CustomSelect
                                    aria-label={t('admin.proxyAccessLogs.filters.status')}
                                    aria-describedby={
                                        filterErrors.status ? 'proxy-log-status-error' : undefined
                                    }
                                    aria-invalid={filterErrors.status !== undefined}
                                    onValueChange={onStatusChange}
                                    options={[
                                        {
                                            label: t('admin.proxyAccessLogs.filters.allStatuses'),
                                            value: '',
                                        },
                                        ...statusOptions.map((status) => ({
                                            label: String(status),
                                            value: String(status),
                                        })),
                                    ]}
                                    placeholder={t('admin.proxyAccessLogs.filters.allStatuses')}
                                    value={filters.status}
                                />
                                {filterErrors.status ? (
                                    <span
                                        id="proxy-log-status-error"
                                        role="alert"
                                        className="text-xs text-danger-text"
                                    >
                                        {t(filterErrors.status)}
                                    </span>
                                ) : null}
                            </label>
                            <label className="grid min-w-0 gap-1.5">
                                <span className="text-xs font-extrabold text-muted">
                                    {t('admin.proxyAccessLogs.filters.search')}
                                </span>
                                <SearchInput
                                    type="search"
                                    value={filters.search}
                                    maxLength={200}
                                    placeholder={t(
                                        'admin.proxyAccessLogs.filters.searchPlaceholder',
                                    )}
                                    onChange={(event) => onSearchChange(event.target.value)}
                                    aria-invalid={filterErrors.search !== undefined}
                                    aria-describedby={
                                        filterErrors.search ? 'proxy-log-search-error' : undefined
                                    }
                                />
                                {filterErrors.search ? (
                                    <span
                                        id="proxy-log-search-error"
                                        role="alert"
                                        className="text-xs text-danger-text"
                                    >
                                        {t(filterErrors.search)}
                                    </span>
                                ) : null}
                            </label>
                            <div className="flex flex-wrap items-end gap-2">{resetButton}</div>
                        </div>
                    )}
                </TableFilters>
            }
            pagination={
                isLoading ? null : (
                    <div>
                        {snapshotReset ? (
                            <output
                                className="block border-t border-border bg-surface-subtle px-4 pt-3 text-xs text-muted"
                                aria-live="polite"
                            >
                                {t('admin.proxyAccessLogs.pagination.snapshotReset')}
                            </output>
                        ) : null}
                        {truncated ? (
                            <p className="bg-surface-subtle px-4 pt-3 text-xs text-muted">
                                {t('admin.proxyAccessLogs.pagination.truncated')}
                            </p>
                        ) : null}
                        <RemoteTablePagination
                            pageIndex={Math.max(currentPage - 1, 0)}
                            pageSize={pageSize}
                            total={total}
                            pageSizeOptions={PROXY_ACCESS_LOGS_PAGE_SIZES}
                            itemLabel={t('admin.proxyAccessLogs.pagination.itemLabel')}
                            onPageChange={(nextPageIndex) => onPageChange(nextPageIndex + 1)}
                            onPageSizeChange={onPageSizeChange}
                            disabled={isLoading}
                        />
                    </div>
                )
            }
        >
            <div className="overflow-x-auto">
                <table className="w-full min-w-[64rem] table-auto border-collapse">
                    <thead className="bg-surface-subtle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase">
                        <tr>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.time')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.host')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.method')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.path')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.status')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.duration')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.clientIp')}
                            </th>
                            <th
                                scope="col"
                                className="h-12 border-b border-border px-4 py-0 text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.bytes')}
                            </th>
                            <th
                                scope="col"
                                className="sticky right-0 h-12 border-b border-border bg-surface-subtle px-4 py-0 text-right"
                            >
                                {t('common.actions')}
                            </th>
                        </tr>
                    </thead>
                    {isLoading ? (
                        <TableLoadingBody
                            columnCount={9}
                            loadingLabel={t('admin.proxyAccessLogs.table.title')}
                        />
                    ) : null}
                    {!isLoading && entries.length === 0 ? (
                        <tbody>
                            <TableBodyState
                                columnCount={9}
                                state={{
                                    title: t('admin.proxyAccessLogs.table.emptyTitle'),
                                    description: hasActiveFilters
                                        ? t('admin.proxyAccessLogs.table.filteredEmptyDescription')
                                        : t('admin.proxyAccessLogs.table.emptyDescription'),
                                }}
                            />
                        </tbody>
                    ) : null}
                    {!isLoading && entries.length > 0 ? (
                        <tbody>
                            {entries.map((entry, index) => {
                                const key = logEntryKey(entry, index)
                                const expanded = expandedEntry === key
                                const detailsId = `proxy-access-log-details-${index}`
                                return (
                                    <Fragment key={key}>
                                        <tr
                                            key={key}
                                            className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover"
                                        >
                                            <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft">
                                                <time
                                                    dateTime={entry.timestamp}
                                                    className="whitespace-nowrap text-muted"
                                                >
                                                    {formatTimestamp(entry.timestamp)}
                                                </time>
                                            </td>
                                            <td className="max-w-48 [overflow-wrap:anywhere] px-4 py-[0.85rem] align-middle text-[0.78rem] font-extrabold text-ink-soft">
                                                {entry.host}
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle font-mono text-xs text-ink-soft">
                                                {entry.method}
                                            </td>
                                            <td className="max-w-80 break-all px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                <CustomTooltip
                                                    {...TOOLTIP_DEFAULT_PROPS}
                                                    content={withoutQueryString(entry.path)}
                                                >
                                                    <span
                                                        aria-label={withoutQueryString(entry.path)}
                                                        className="block max-w-80 break-all"
                                                    >
                                                        {withoutQueryString(entry.path)}
                                                    </span>
                                                </CustomTooltip>
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle">
                                                <span
                                                    className={`inline-flex rounded-full border px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold ${statusClassName(entry.status)}`}
                                                >
                                                    {entry.status}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                {formatDuration(entry.durationMs)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                <ClientIpCountry entry={entry} />
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                {formatBytes(entry.bytes, locale)}
                                            </td>
                                            <td className="sticky right-0 bg-surface px-4 py-[0.85rem] align-middle text-right">
                                                <ActionMenu
                                                    openOnHover
                                                    items={[
                                                        {
                                                            label: t(
                                                                expanded
                                                                    ? 'admin.proxyAccessLogs.actions.hideDetails'
                                                                    : 'admin.proxyAccessLogs.actions.showDetails',
                                                            ),
                                                            onSelect: () => onToggleDetails(key),
                                                        },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                        {expanded ? (
                                            <tr
                                                id={detailsId}
                                                key={`${key}-details`}
                                                className="border-b border-border bg-surface-subtle"
                                            >
                                                <td
                                                    colSpan={9}
                                                    aria-label={t(
                                                        'admin.proxyAccessLogs.actions.showDetails',
                                                    )}
                                                    className="px-4 py-3"
                                                >
                                                    <LogDetails entry={entry} />
                                                </td>
                                            </tr>
                                        ) : null}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    ) : null}
                </table>
            </div>
        </TableLayout>
    )
}
