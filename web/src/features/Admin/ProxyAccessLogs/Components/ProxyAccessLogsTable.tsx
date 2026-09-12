import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Fragment } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import TableBodyState from '../../../../shared/Table/Components/TableBodyState'
import TableFilters from '../../../../shared/Table/Components/TableFilters'
import TableLayout from '../../../../shared/Table/Components/TableLayout'
import TableLoadingBody from '../../../../shared/Table/Components/TableLoadingBody'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { Tooltip } from '../../../../shared/Tooltip'
import type { ProxyAccessLogEntry } from '../../../../shared/Types/proxy-access-logs.types'
import { formatBytes, formatDuration, withoutQueryString } from '../Helpers/proxyAccessLogs'
import type { ProxyAccessLogsTableProps } from '../Types/proxy-access-logs.types'

const tableControlClassName =
    'h-12 min-w-0 w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20'

const statusClassName = (status: number) =>
    status >= 500
        ? 'border-red-500/25 bg-danger-bg text-danger-text'
        : status >= 400
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-700'
          : status >= 300
            ? 'border-blue-500/20 bg-info-bg text-info-text'
            : 'border-brand-600/20 bg-success-bg text-success-text'

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
    expandedEntry,
    formatTimestamp,
    filters,
    filterErrors,
    total,
    offset,
    limit,
    hasMore,
    truncated,
    isLoading,
    isRefreshing,
    onHostChange,
    onStatusChange,
    onSearchChange,
    onApplyFilters,
    onResetFilters,
    onRefresh,
    onPreviousPage,
    onNextPage,
    onToggleDetails,
}: ProxyAccessLogsTableProps) {
    const { locale, t } = useTranslationStore()
    const activeFilterCount = [
        filters.host.trim(),
        filters.status.trim(),
        filters.search.trim(),
    ].filter((value) => value.length > 0).length
    const hasActiveFilters = activeFilterCount > 0
    const firstItem = entries.length === 0 ? 0 : offset + 1
    const lastItem = offset + entries.length
    const currentPage = Math.floor(offset / Math.max(limit, 1)) + 1
    const pageCount = hasMore ? currentPage + 1 : Math.max(currentPage, 1)

    return (
        <TableLayout
            titleId="proxy-access-logs-table-title"
            eyebrow={t('admin.proxyAccessLogs.table.eyebrow')}
            title={t('admin.proxyAccessLogs.table.title')}
            description={t('admin.proxyAccessLogs.table.description')}
            toolbar={
                <button
                    type="button"
                    className={uiClassNames.button.secondary}
                    onClick={onRefresh}
                    disabled={isRefreshing}
                >
                    <RefreshCw
                        aria-hidden="true"
                        className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`}
                    />
                    {t('admin.proxyAccessLogs.actions.refresh')}
                </button>
            }
            filters={
                <TableFilters activeCount={activeFilterCount} onReset={onResetFilters}>
                    <form
                        className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 items-end"
                        onSubmit={(event) => {
                            event.preventDefault()
                            onApplyFilters()
                        }}
                    >
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.proxyAccessLogs.filters.host')}
                            </span>
                            <input
                                type="text"
                                value={filters.host}
                                maxLength={254}
                                placeholder={t('admin.proxyAccessLogs.filters.hostPlaceholder')}
                                onChange={(event) => onHostChange(event.target.value)}
                                aria-invalid={filterErrors.host !== undefined}
                                aria-describedby={
                                    filterErrors.host ? 'proxy-log-host-error' : undefined
                                }
                                className={tableControlClassName}
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
                        </label>
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.proxyAccessLogs.filters.status')}
                            </span>
                            <input
                                type="number"
                                value={filters.status}
                                min={100}
                                max={599}
                                step={1}
                                inputMode="numeric"
                                placeholder={t('admin.proxyAccessLogs.filters.statusPlaceholder')}
                                onChange={(event) => onStatusChange(event.target.value)}
                                aria-invalid={filterErrors.status !== undefined}
                                aria-describedby={
                                    filterErrors.status ? 'proxy-log-status-error' : undefined
                                }
                                className={tableControlClassName}
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
                            <input
                                type="search"
                                value={filters.search}
                                maxLength={200}
                                placeholder={t('admin.proxyAccessLogs.filters.searchPlaceholder')}
                                onChange={(event) => onSearchChange(event.target.value)}
                                aria-invalid={filterErrors.search !== undefined}
                                aria-describedby={
                                    filterErrors.search ? 'proxy-log-search-error' : undefined
                                }
                                className={tableControlClassName}
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
                        <div className="flex items-end">
                            <button
                                type="submit"
                                className={uiClassNames.button.primary}
                                disabled={isRefreshing}
                            >
                                {t('admin.proxyAccessLogs.actions.apply')}
                            </button>
                        </div>
                    </form>
                </TableFilters>
            }
            pagination={
                <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                        <p aria-live="polite">
                            <span className="font-extrabold text-ink-soft">
                                {t('admin.proxyAccessLogs.pagination.range', {
                                    from: firstItem,
                                    to: lastItem,
                                    count: total,
                                })}
                            </span>
                        </p>
                        {truncated ? (
                            <span>{t('admin.proxyAccessLogs.pagination.truncated')}</span>
                        ) : null}
                    </div>
                    <nav
                        aria-label={t('admin.proxyAccessLogs.pagination.label')}
                        className="flex items-center justify-between gap-2 sm:justify-end"
                    >
                        <p
                            className="mr-1 min-w-20 text-center text-xs text-muted"
                            aria-live="polite"
                        >
                            {t('admin.proxyAccessLogs.pagination.page', {
                                page: currentPage,
                                count: pageCount,
                            })}
                        </p>
                        <button
                            type="button"
                            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                            onClick={onPreviousPage}
                            disabled={offset === 0 || isRefreshing}
                            aria-label={t('admin.proxyAccessLogs.pagination.previous')}
                        >
                            <ChevronLeft aria-hidden="true" className="size-4" />
                        </button>
                        <button
                            type="button"
                            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                            onClick={onNextPage}
                            disabled={!hasMore || isRefreshing}
                            aria-label={t('admin.proxyAccessLogs.pagination.next')}
                        >
                            <ChevronRight aria-hidden="true" className="size-4" />
                        </button>
                    </nav>
                </div>
            }
        >
            <div className="overflow-x-auto">
                <table className="w-full min-w-[72rem] border-collapse">
                    <thead className="bg-surface-subtle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase">
                        <tr>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.time')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.host')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.method')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.path')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.status')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.duration')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.clientIp')}
                            </th>
                            <th
                                scope="col"
                                className="border-b border-border px-4 py-[0.85rem] text-left"
                            >
                                {t('admin.proxyAccessLogs.columns.bytes')}
                            </th>
                        </tr>
                    </thead>
                    {isLoading ? (
                        <TableLoadingBody
                            columnCount={8}
                            loadingLabel={t('admin.proxyAccessLogs.table.title')}
                        />
                    ) : null}
                    {!isLoading && entries.length === 0 ? (
                        <tbody>
                            <TableBodyState
                                columnCount={8}
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
                                                <button
                                                    type="button"
                                                    aria-expanded={expanded}
                                                    aria-controls={detailsId}
                                                    aria-label={t(
                                                        expanded
                                                            ? 'admin.proxyAccessLogs.actions.hideDetails'
                                                            : 'admin.proxyAccessLogs.actions.showDetails',
                                                    )}
                                                    className="cursor-pointer rounded-md text-left outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                                    onClick={() => onToggleDetails(key)}
                                                >
                                                    <time
                                                        dateTime={entry.timestamp}
                                                        className="whitespace-nowrap text-muted"
                                                    >
                                                        {formatTimestamp(entry.timestamp)}
                                                    </time>
                                                </button>
                                            </td>
                                            <td className="max-w-48 break-words px-4 py-[0.85rem] align-middle text-[0.78rem] font-extrabold text-ink-soft">
                                                {entry.host}
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle font-mono text-xs text-ink-soft">
                                                {entry.method}
                                            </td>
                                            <td className="max-w-80 break-all px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                <Tooltip content={withoutQueryString(entry.path)}>
                                                    <span
                                                        aria-label={withoutQueryString(entry.path)}
                                                        className="block max-w-80 break-all"
                                                    >
                                                        {withoutQueryString(entry.path)}
                                                    </span>
                                                </Tooltip>
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
                                            <td className="max-w-44 break-all px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                {entry.clientIp}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                {formatBytes(entry.bytes, locale)}
                                            </td>
                                        </tr>
                                        {expanded ? (
                                            <tr
                                                id={detailsId}
                                                key={`${key}-details`}
                                                className="border-b border-border bg-surface-subtle"
                                            >
                                                <td
                                                    colSpan={8}
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
