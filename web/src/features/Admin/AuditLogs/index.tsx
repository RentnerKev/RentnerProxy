import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import type { AuditLogsPageProps } from './Types/audit-logs.types.ts'
import useAuditLogsLogic from './Hooks/useAuditLogsLogic.ts'
import AuditLogsTable from './Components/AuditLogsTable/index.tsx'

export default function AuditLogsPage(props: AuditLogsPageProps) {
    const { state, handler } = useAuditLogsLogic(props)
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
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <AuditLogsTable
                    actorOptions={state.actorOptions}
                    events={state.events}
                    expandedEventId={state.expandedEventId}
                    formatTimestamp={state.formatTimestamp}
                    filters={state.filters}
                    filterErrors={state.filterErrors}
                    hasMore={state.hasMore}
                    isLoading={state.isLoading}
                    pageNumber={state.pageNumber}
                    onActorChange={handler.onActorChange}
                    onActionChange={handler.onActionChange}
                    onResourceChange={handler.onResourceChange}
                    onFromChange={handler.onFromChange}
                    onToChange={handler.onToChange}
                    onResetFilters={handler.resetFilters}
                    onPreviousPage={handler.previousPage}
                    onNextPage={handler.nextPage}
                    onToggleDetails={handler.onToggleDetails}
                />
            )}
        </>
    )
}
