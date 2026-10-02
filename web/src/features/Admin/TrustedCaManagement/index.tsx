import { Plus } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import type { TrustedCaManagementPageProps } from './Types/trusted-ca-management.types.ts'
import useTrustedCaManagementLogic from './Hooks/useTrustedCaManagementLogic.ts'
import TrustedCaImportModal from './Components/TrustedCaImportModal/index.tsx'
import TrustedCasTable from './Components/TrustedCasTable/index.tsx'

export default function TrustedCaManagementPage(props: TrustedCaManagementPageProps) {
    const { state, handler } = useTrustedCaManagementLogic(props)
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.trustedCas.page.eyebrow')}
                title={t('admin.trustedCas.page.title')}
                description={t('admin.trustedCas.page.description')}
                action={
                    state.isError && state.canCreate ? (
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
                            onClick={handler.openImport}
                            disabled={state.isMutating}
                        >
                            <Plus aria-hidden="true" className="size-4" />
                            {t('admin.trustedCas.actions.import')}
                        </button>
                    ) : undefined
                }
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.trustedCas.states.unavailableTitle')}
                    description={t('admin.trustedCas.states.unavailableDescription')}
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
                <TrustedCasTable
                    {...state}
                    loading={state.isLoading}
                    isPending={state.isMutating}
                    onCreate={handler.openImport}
                    onReplace={handler.openReplace}
                    onDelete={handler.openDelete}
                />
            )}
            {state.importOpen ? (
                <TrustedCaImportModal
                    open
                    onOpenChange={handler.setImportOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.replaceTarget ? (
                <TrustedCaImportModal
                    key={state.replaceTarget.id}
                    open
                    trustedCa={state.replaceTarget}
                    onOpenChange={handler.setReplaceOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.trustedCas.confirm.deleteTitle', {
                        name: state.deleteTarget.name,
                    })}
                    description={t('admin.trustedCas.confirm.deleteDescription')}
                    confirmLabel={t('admin.trustedCas.actions.delete')}
                    pendingLabel={t('admin.trustedCas.actions.deleting')}
                    destructive
                    isPending={state.isMutating}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}
