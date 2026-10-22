import { Plus } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import type { TrustedCaManagementPageProps } from './Types/trusted-ca-management.types.ts'
import useTrustedCaManagementLogic from './Hooks/useTrustedCaManagementLogic.ts'
import TrustedCaImportModal from './Components/TrustedCaImportModal/index.tsx'
import TrustedCasTable from './Components/TrustedCasTable/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

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
                            className={buttonClassName(
                                'primary',
                                'min-w-[8.5rem] whitespace-nowrap',
                            )}
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
                <PageAlert
                    severity="error"
                    title={t('admin.trustedCas.states.unavailableTitle')}
                    description={t('admin.trustedCas.states.unavailableDescription')}
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
