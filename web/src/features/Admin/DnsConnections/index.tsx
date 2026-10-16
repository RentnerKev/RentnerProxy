import { Plus } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import DnsConnectionEditor from './Components/DnsConnectionEditor.tsx'
import useDnsConnectionsLogic from './Hooks/useDnsConnectionsLogic.ts'
import type { DnsConnectionsPageProps } from './Types/dns-connections-ui.types.ts'

export default function DnsConnectionsPage(props: DnsConnectionsPageProps) {
    const logic = useDnsConnectionsLogic(props)
    const { state, handler } = logic
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.dnsConnections.page.eyebrow')}
                title={t('admin.dnsConnections.page.title')}
                description={t('admin.dnsConnections.page.description')}
            />
            <div className="mb-5 flex flex-wrap justify-end gap-2">
                <button
                    type="button"
                    onClick={handler.handleRefresh}
                    disabled={state.isPending}
                    className="h-12 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                >
                    {t('admin.dnsConnections.actions.reload')}
                </button>
                {state.canManage ? (
                    <button
                        type="button"
                        onClick={handler.handleCreate}
                        disabled={state.isPending}
                        className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground enabled:hover:bg-accent-hover disabled:opacity-50"
                    >
                        <Plus aria-hidden="true" className="size-4" />
                        {t('admin.dnsConnections.actions.add')}
                    </button>
                ) : null}
            </div>
            {!state.editorOpen && state.error ? (
                <p role="alert" className="mb-4 rounded-xl bg-danger-bg p-4 text-danger-text">
                    {t(state.error)}
                </p>
            ) : null}
            {!state.editorOpen && state.notice ? (
                <output className="mb-4 block text-muted">{t(state.notice)}</output>
            ) : null}
            {state.isLoading ? (
                <ContentState
                    busy
                    title={t('common.loading')}
                    description={t('admin.dnsConnections.states.loading')}
                />
            ) : state.isError ? (
                <ContentState
                    title={t('admin.dnsConnections.states.error')}
                    description={t('common.requestFailed')}
                    action={
                        <button
                            type="button"
                            onClick={handler.handleRefresh}
                            className="h-12 rounded-xl border border-border-strong px-4 text-ink-soft"
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : state.connections.length === 0 ? (
                <ContentState
                    title={t('admin.dnsConnections.states.empty')}
                    description={t('admin.dnsConnections.states.emptyDescription')}
                />
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {state.connections.map((connection) => (
                        <article
                            key={connection.id}
                            className="grid content-start gap-4 rounded-2xl border border-border bg-surface p-5 shadow-panel"
                        >
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                                    {t('admin.dnsConnections.provider')}
                                </p>
                                <h2 className="mt-1 break-words text-lg font-extrabold text-ink-soft">
                                    {connection.name}
                                </h2>
                            </div>
                            <ul className="grid gap-2 text-sm text-ink-soft">
                                {connection.zones.map((zone) => (
                                    <li
                                        key={zone.id}
                                        className="break-words rounded-lg bg-surface-subtle px-3 py-2"
                                    >
                                        {zone.name}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-sm text-muted">
                                {t('admin.dnsConnections.usage', {
                                    count: connection.references.length,
                                })}
                            </p>
                            {connection.references.length > 0 ? (
                                <p className="text-sm text-muted">
                                    {t('admin.dnsConnections.form.deleteInUse')}
                                </p>
                            ) : null}
                            {state.canManage ? (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handler.handleEdit(connection)}
                                        disabled={state.isPending}
                                        className="h-12 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                                    >
                                        {t('admin.dnsConnections.actions.edit')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handler.handleDelete(connection)}
                                        disabled={
                                            state.isPending || connection.references.length > 0
                                        }
                                        className="h-12 rounded-xl border border-red-700/25 bg-danger-bg px-4 text-sm font-extrabold text-danger-text disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {t('admin.dnsConnections.actions.delete')}
                                    </button>
                                </div>
                            ) : null}
                        </article>
                    ))}
                </div>
            )}
            {state.editorOpen ? <DnsConnectionEditor {...logic} /> : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    title={t('admin.dnsConnections.confirm.title')}
                    description={t('admin.dnsConnections.confirm.description', {
                        name: state.deleteTarget.name,
                    })}
                    confirmLabel={t('admin.dnsConnections.actions.delete')}
                    destructive
                    isPending={state.isPending}
                    onConfirm={handler.handleConfirmDelete}
                    onOpenChange={handler.handleDeleteOpenChange}
                />
            ) : null}
        </>
    )
}
