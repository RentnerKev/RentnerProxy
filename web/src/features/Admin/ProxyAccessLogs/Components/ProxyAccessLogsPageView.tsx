import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyAccessLogsPageViewProps } from '../Types/proxy-access-logs.types'
import ProxyAccessLogsTable from './ProxyAccessLogsTable'

export default function ProxyAccessLogsPageView({
    logic: { state, handler },
}: ProxyAccessLogsPageViewProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <PageHeader
                eyebrow={t('admin.proxyAccessLogs.page.eyebrow')}
                title={t('admin.proxyAccessLogs.page.title')}
                description={t('admin.proxyAccessLogs.page.description')}
            />
            <p className="-mt-4 mb-8 max-w-2xl text-xs leading-relaxed text-muted">
                {t('admin.proxyAccessLogs.page.retention')}
            </p>

            {!state.canView ? (
                <ContentState
                    title={t('admin.proxyAccessLogs.states.forbiddenTitle')}
                    description={t('admin.proxyAccessLogs.states.forbiddenDescription')}
                />
            ) : state.isError ? (
                <ContentState
                    title={t('admin.proxyAccessLogs.states.unavailableTitle')}
                    description={t('admin.proxyAccessLogs.states.unavailableDescription')}
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
                <ProxyAccessLogsTable
                    entries={state.entries}
                    expandedEntry={state.expandedEntry}
                    formatTimestamp={state.formatTimestamp}
                    filters={state.filters}
                    filterErrors={state.filterErrors}
                    total={state.total}
                    offset={state.offset}
                    limit={state.limit}
                    hasMore={state.hasMore}
                    truncated={state.truncated}
                    isLoading={state.isLoading}
                    isRefreshing={state.isRefreshing}
                    onHostChange={handler.onHostChange}
                    onStatusChange={handler.onStatusChange}
                    onSearchChange={handler.onSearchChange}
                    onApplyFilters={handler.applyFilters}
                    onResetFilters={handler.resetFilters}
                    onRefresh={handler.refresh}
                    onPreviousPage={handler.previousPage}
                    onNextPage={handler.nextPage}
                    onToggleDetails={handler.toggleEntryDetails}
                />
            )}
        </>
    )
}
