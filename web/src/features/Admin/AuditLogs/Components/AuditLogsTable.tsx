import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Fragment } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import TableBodyState from '../../../../shared/Table/Components/TableBodyState'
import TableFilters from '../../../../shared/Table/Components/TableFilters'
import TableLayout from '../../../../shared/Table/Components/TableLayout'
import TableLoadingBody from '../../../../shared/Table/Components/TableLoadingBody'
import SelectControl from '../../../../shared/Select'
import DateTimeCalendar from '../../../../shared/Calendar/Components/DateTimeCalendar'
import { ActionMenu } from '../../../../shared/ActionMenu'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { Tooltip } from '../../../../shared/Tooltip'
import type { AuditEventDto } from '../../../../shared/Types/audit-events.types'
import {
    auditActionValues,
    auditEventKey,
    auditResourceValues,
    formatAuditActor,
    getAuditMetadataEntries,
    resultClassName,
} from '../Helpers/auditLogs'
import type { AuditLogsTableProps } from '../Types/audit-logs.types'

const tableControlClassName =
    'h-12 min-w-0 w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20'

function MetadataDetails({ event }: { readonly event: AuditEventDto }) {
    const { t } = useTranslationStore()
    const metadata = getAuditMetadataEntries(event.metadata)

    return (
        <dl className="grid gap-4 text-xs text-muted sm:grid-cols-2 lg:grid-cols-3">
            <div>
                <dt className="font-mono text-[0.65rem] tracking-[0.06em] text-muted-soft uppercase">
                    {t('admin.auditLogs.columns.actorKind')}
                </dt>
                <dd className="mt-1 font-mono text-ink-soft">
                    {t(`admin.auditLogs.values.actorKinds.${event.actorKind}`)}
                </dd>
            </div>
            <div>
                <dt className="font-mono text-[0.65rem] tracking-[0.06em] text-muted-soft uppercase">
                    {t('admin.auditLogs.columns.eventId')}
                </dt>
                <dd className="mt-1 break-all font-mono text-ink-soft">{event.id}</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
                <dt className="font-mono text-[0.65rem] tracking-[0.06em] text-muted-soft uppercase">
                    {t('admin.auditLogs.columns.metadata')}
                </dt>
                <dd className="mt-1 font-mono text-ink-soft">
                    {metadata.length > 0
                        ? metadata.map(({ key, value }) => (
                              <div className="break-words" key={key}>
                                  <span className="text-muted-soft">
                                      {t(`admin.auditLogs.metadata.${key}`)}:
                                  </span>{' '}
                                  {value}
                              </div>
                          ))
                        : t('admin.auditLogs.details.noMetadata')}
                </dd>
            </div>
        </dl>
    )
}

export default function AuditLogsTable({
    events,
    expandedEventId,
    formatTimestamp,
    filters,
    filterErrors,
    hasMore,
    isLoading,
    isRefreshing,
    pageNumber,
    onActorChange,
    onActionChange,
    onResourceChange,
    onFromChange,
    onToChange,
    onApplyFilters,
    onResetFilters,
    onRefresh,
    onPreviousPage,
    onNextPage,
    onToggleDetails,
}: AuditLogsTableProps) {
    const { t } = useTranslationStore()
    const activeFilterCount = [
        filters.actorUserId.trim(),
        filters.action,
        filters.resource,
        filters.from,
        filters.to,
    ].filter((value) => value.length > 0).length
    const hasActiveFilters = activeFilterCount > 0

    return (
        <TableLayout
            titleId="audit-logs-table-title"
            eyebrow={t('admin.auditLogs.table.eyebrow')}
            title={t('admin.auditLogs.table.title')}
            description={t('admin.auditLogs.table.description')}
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
                    {t('admin.auditLogs.actions.refresh')}
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
                                {t('admin.auditLogs.filters.actor')}
                            </span>
                            <input
                                type="text"
                                value={filters.actorUserId}
                                maxLength={36}
                                placeholder={t('admin.auditLogs.filters.actorPlaceholder')}
                                onChange={(event) => onActorChange(event.target.value)}
                                aria-invalid={filterErrors.actorUserId !== undefined}
                                aria-describedby={
                                    filterErrors.actorUserId ? 'audit-log-actor-error' : undefined
                                }
                                className={tableControlClassName}
                            />
                            {filterErrors.actorUserId ? (
                                <span
                                    id="audit-log-actor-error"
                                    role="alert"
                                    className="text-xs text-danger-text"
                                >
                                    {t(filterErrors.actorUserId)}
                                </span>
                            ) : null}
                        </label>
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.auditLogs.filters.action')}
                            </span>
                            <SelectControl
                                ariaLabel={t('admin.auditLogs.filters.action')}
                                className={tableControlClassName}
                                value={filters.action}
                                placeholder={t('admin.auditLogs.filters.allActions')}
                                onValueChange={(value) =>
                                    onActionChange(
                                        value as AuditLogsTableProps['filters']['action'],
                                    )
                                }
                                options={auditActionValues.map((action) => ({
                                    label: t(`admin.auditLogs.values.actions.${action}`),
                                    value: action,
                                }))}
                            />
                        </label>
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.auditLogs.filters.resource')}
                            </span>
                            <SelectControl
                                ariaLabel={t('admin.auditLogs.filters.resource')}
                                className={tableControlClassName}
                                value={filters.resource}
                                placeholder={t('admin.auditLogs.filters.allResources')}
                                onValueChange={(value) =>
                                    onResourceChange(
                                        value as AuditLogsTableProps['filters']['resource'],
                                    )
                                }
                                options={auditResourceValues.map((resource) => ({
                                    label: t(`admin.auditLogs.values.resources.${resource}`),
                                    value: resource,
                                }))}
                            />
                        </label>
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.auditLogs.filters.from')}
                            </span>
                            <DateTimeCalendar
                                value={filters.from}
                                onValueChange={onFromChange}
                                ariaLabel={t('admin.auditLogs.filters.from')}
                                invalid={
                                    filterErrors.from !== undefined ||
                                    filterErrors.dateRange !== undefined
                                }
                                describedBy={
                                    filterErrors.dateRange ? 'audit-date-range-error' : undefined
                                }
                            />
                        </label>
                        <label className="grid min-w-0 gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {t('admin.auditLogs.filters.to')}
                            </span>
                            <DateTimeCalendar
                                value={filters.to}
                                onValueChange={onToChange}
                                ariaLabel={t('admin.auditLogs.filters.to')}
                                invalid={
                                    filterErrors.to !== undefined ||
                                    filterErrors.dateRange !== undefined
                                }
                                describedBy={
                                    filterErrors.dateRange ? 'audit-date-range-error' : undefined
                                }
                            />
                        </label>
                        <div className="flex items-end">
                            <button
                                type="submit"
                                className={uiClassNames.button.primary}
                                disabled={isRefreshing}
                            >
                                {t('admin.auditLogs.actions.apply')}
                            </button>
                        </div>
                        {filterErrors.dateRange ? (
                            <span
                                id="audit-date-range-error"
                                role="alert"
                                className="col-span-full text-xs text-danger-text"
                            >
                                {t(filterErrors.dateRange)}
                            </span>
                        ) : null}
                    </form>
                </TableFilters>
            }
            pagination={
                <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p aria-live="polite" className="text-xs text-muted">
                        <span className="font-extrabold text-ink-soft">
                            {t('admin.auditLogs.pagination.pageSummary', {
                                count: events.length,
                            })}
                        </span>
                    </p>
                    <nav
                        aria-label={t('admin.auditLogs.pagination.label')}
                        className="flex items-center justify-between gap-2 sm:justify-end"
                    >
                        <p
                            className="mr-1 min-w-20 text-center text-xs text-muted"
                            aria-live="polite"
                        >
                            {t('admin.auditLogs.pagination.page', { page: pageNumber })}
                        </p>
                        <button
                            type="button"
                            className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                            onClick={onPreviousPage}
                            disabled={pageNumber === 1 || isRefreshing}
                            aria-label={t('admin.auditLogs.pagination.previous')}
                        >
                            <ChevronLeft aria-hidden="true" className="size-4" />
                        </button>
                        <button
                            type="button"
                            className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                            onClick={onNextPage}
                            disabled={!hasMore || isRefreshing}
                            aria-label={t('admin.auditLogs.pagination.next')}
                        >
                            <ChevronRight aria-hidden="true" className="size-4" />
                        </button>
                    </nav>
                </div>
            }
        >
            <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-44" />
                        <col className="w-48" />
                        <col className="w-28" />
                        <col className="w-28" />
                        <col />
                        <col className="w-28" />
                        <col className="w-24" />
                    </colgroup>
                    <thead className="bg-surface-subtle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase">
                        <tr>
                            {(
                                [
                                    'time',
                                    'actor',
                                    'action',
                                    'resource',
                                    'target',
                                    'result',
                                    'details',
                                ] as const
                            ).map((column) => (
                                <th
                                    key={column}
                                    scope="col"
                                    className={`h-12 border-b border-border px-4 py-0 ${column === 'details' ? 'sticky right-0 bg-surface-subtle text-right' : 'text-left'}`}
                                >
                                    {column === 'details'
                                        ? t('common.actions')
                                        : t(`admin.auditLogs.columns.${column}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    {isLoading ? (
                        <TableLoadingBody
                            columnCount={7}
                            loadingLabel={t('admin.auditLogs.table.title')}
                        />
                    ) : null}
                    {!isLoading && events.length === 0 ? (
                        <tbody>
                            <TableBodyState
                                columnCount={7}
                                state={{
                                    title: t('admin.auditLogs.table.emptyTitle'),
                                    description: hasActiveFilters
                                        ? t('admin.auditLogs.table.filteredEmptyDescription')
                                        : t('admin.auditLogs.table.emptyDescription'),
                                }}
                            />
                        </tbody>
                    ) : null}
                    {!isLoading && events.length > 0 ? (
                        <tbody>
                            {events.map((event) => {
                                const eventId = auditEventKey(event)
                                const expanded = expandedEventId === eventId
                                const detailsId = `audit-log-details-${eventId}`
                                return (
                                    <Fragment key={eventId}>
                                        <tr className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover">
                                            <td className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft">
                                                <time
                                                    dateTime={event.timestamp}
                                                    className="whitespace-nowrap text-muted"
                                                >
                                                    {formatTimestamp(event.timestamp)}
                                                </time>
                                            </td>
                                            <td className="max-w-48 [overflow-wrap:anywhere] px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft">
                                                <span className="font-extrabold">
                                                    {formatAuditActor(event)}
                                                </span>
                                                {event.actorUserId && event.actorDisplayName ? (
                                                    <Tooltip content={event.actorUserId}>
                                                        <span
                                                            aria-label={event.actorUserId}
                                                            className="mt-1 block max-w-48 truncate font-mono text-[0.68rem] text-muted"
                                                        >
                                                            {event.actorUserId}
                                                        </span>
                                                    </Tooltip>
                                                ) : null}
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle text-xs font-extrabold text-ink-soft">
                                                {t(
                                                    `admin.auditLogs.values.actions.${event.action}`,
                                                )}
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle text-xs text-muted">
                                                {t(
                                                    `admin.auditLogs.values.resources.${event.resource}`,
                                                )}
                                            </td>
                                            <td className="max-w-48 break-all px-4 py-[0.85rem] align-middle font-mono text-xs text-muted">
                                                {event.targetId ?? '—'}
                                            </td>
                                            <td className="px-4 py-[0.85rem] align-middle">
                                                <span
                                                    className={`inline-flex rounded-full border px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold ${resultClassName(event.result)}`}
                                                >
                                                    {t(
                                                        `admin.auditLogs.values.results.${event.result}`,
                                                    )}
                                                </span>
                                            </td>
                                            <td className="sticky right-0 bg-surface px-4 py-[0.85rem] align-middle text-right">
                                                <ActionMenu
                                                    openOnHover
                                                    items={[
                                                        {
                                                            label: t(
                                                                expanded
                                                                    ? 'admin.auditLogs.actions.hideDetails'
                                                                    : 'admin.auditLogs.actions.showDetails',
                                                            ),
                                                            onSelect: () =>
                                                                onToggleDetails(eventId),
                                                        },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                        {expanded ? (
                                            <tr
                                                id={detailsId}
                                                className="border-b border-border bg-surface-subtle"
                                            >
                                                <td
                                                    colSpan={7}
                                                    aria-label={t(
                                                        'admin.auditLogs.actions.showDetails',
                                                    )}
                                                    className="px-4 py-3"
                                                >
                                                    <MetadataDetails event={event} />
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
