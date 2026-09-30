import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
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
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <ProxyAccessLogsTable
                    entries={state.entries}
                    availableHosts={state.availableHosts}
                    availableStatuses={state.availableStatuses}
                    expandedEntry={state.expandedEntry}
                    formatTimestamp={state.formatTimestamp}
                    filters={state.filters}
                    filterErrors={state.filterErrors}
                    total={state.total}
                    truncated={state.truncated}
                    snapshotReset={state.snapshotReset}
                    pageSize={state.pageSize}
                    currentPage={state.currentPage}
                    isLoading={state.isLoading}
                    onHostChange={handler.onHostChange}
                    onStatusChange={handler.onStatusChange}
                    onSearchChange={handler.onSearchChange}
                    onResetFilters={handler.resetFilters}
                    onPageChange={handler.onPageChange}
                    onPageSizeChange={handler.onPageSizeChange}
                    onToggleDetails={handler.toggleEntryDetails}
                />
            )}
        </>
    )
}
