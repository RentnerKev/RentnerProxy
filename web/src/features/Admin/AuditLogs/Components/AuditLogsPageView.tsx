import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { AuditLogsPageViewProps } from '../Types/audit-logs.types'
import AuditLogsTable from './AuditLogsTable'

export default function AuditLogsPageView({ logic: { state, handler } }: AuditLogsPageViewProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <PageHeader
                eyebrow={t('admin.auditLogs.page.eyebrow')}
                title={t('admin.auditLogs.page.title')}
                description={t('admin.auditLogs.page.description')}
            />
            <p className="-mt-4 mb-8 max-w-2xl text-xs leading-relaxed text-muted">
                {t('admin.auditLogs.page.retention')}
            </p>

            {!state.canView ? (
                <ContentState
                    title={t('admin.auditLogs.states.forbiddenTitle')}
                    description={t('admin.auditLogs.states.forbiddenDescription')}
                />
            ) : state.isError ? (
                <ContentState
                    title={t('admin.auditLogs.states.unavailableTitle')}
                    description={t('admin.auditLogs.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <AuditLogsTable
                    events={state.events}
                    expandedEventId={state.expandedEventId}
                    formatTimestamp={state.formatTimestamp}
                    filters={state.filters}
                    filterErrors={state.filterErrors}
                    hasMore={state.hasMore}
                    isLoading={state.isLoading}
                    isRefreshing={state.isRefreshing}
                    pageNumber={state.pageNumber}
                    onActorChange={handler.onActorChange}
                    onActionChange={handler.onActionChange}
                    onResourceChange={handler.onResourceChange}
                    onFromChange={handler.onFromChange}
                    onToChange={handler.onToChange}
                    onApplyFilters={handler.applyFilters}
                    onResetFilters={handler.resetFilters}
                    onRefresh={handler.refresh}
                    onPreviousPage={handler.previousPage}
                    onNextPage={handler.nextPage}
                    onToggleDetails={handler.onToggleDetails}
                />
            )}
        </>
    )
}
