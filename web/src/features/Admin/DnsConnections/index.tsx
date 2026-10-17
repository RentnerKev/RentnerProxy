import { Plus } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import DnsConnectionEditor from './Components/DnsConnectionEditor.tsx'
import DnsConnectionCard from './Components/DnsConnectionCard.tsx'
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
                action={
                    state.canManage ? (
                        <button
                            type="button"
                            onClick={handler.handleCreate}
                            disabled={state.isPending}
                            className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground enabled:hover:bg-accent-hover disabled:opacity-50"
                        >
                            <Plus aria-hidden="true" className="size-4" />
                            {t('admin.dnsConnections.actions.add')}
                        </button>
                    ) : null
                }
            />
            {state.isLoading ? (
                <ContentState
                    busy
                    title={t('common.loading')}
                    description={t('admin.dnsConnections.states.loading')}
                />
            ) : !state.connections.length ? (
                <ContentState
                    title={t(
                        state.isError
                            ? 'admin.dnsConnections.states.error'
                            : 'admin.dnsConnections.states.empty',
                    )}
                    description={t(
                        state.isError
                            ? 'admin.dnsConnections.states.waiting'
                            : 'admin.dnsConnections.states.emptyDescription',
                    )}
                />
            ) : (
                <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                    {state.connections.map((connection) => (
                        <DnsConnectionCard
                            key={connection.id}
                            connection={connection}
                            canManage={state.canManage}
                            isPending={state.isPending}
                            onEdit={handler.handleEdit}
                            onDelete={handler.handleDelete}
                        />
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
