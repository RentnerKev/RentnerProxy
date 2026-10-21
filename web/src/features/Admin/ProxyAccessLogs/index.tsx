import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import type { ProxyAccessLogsPageProps } from './Types/proxy-access-logs.types.ts'
import useProxyAccessLogsLogic from './Hooks/useProxyAccessLogsLogic.ts'
import ProxyAccessLogsTable from './Components/ProxyAccessLogsTable/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function ProxyAccessLogsPage(props: ProxyAccessLogsPageProps) {
    const { state, handler } = useProxyAccessLogsLogic(props)
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
                <PageAlert
                    severity="error"
                    title={t('admin.proxyAccessLogs.states.unavailableTitle')}
                    description={t('admin.proxyAccessLogs.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
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
