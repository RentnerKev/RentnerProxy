import { Plus } from 'lucide-react'
import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { TrustedCaManagementPageViewProps } from '../Types/trusted-ca-management.types'
import TrustedCaImportModal from './TrustedCaImportModal'
import TrustedCasTable from './TrustedCasTable'

export default function TrustedCaManagementPageView({
    logic: { state, handler },
}: TrustedCaManagementPageViewProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.trustedCas.page.eyebrow')}
                title={t('admin.trustedCas.page.title')}
                description={t('admin.trustedCas.page.description')}
                action={
                    state.canCreate ? (
                        <button
                            type="button"
                            className={uiClassNames.button.add}
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
                            className={uiClassNames.button.secondary}
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
