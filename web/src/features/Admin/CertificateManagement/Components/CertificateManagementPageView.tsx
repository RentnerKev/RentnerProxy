import { Plus } from 'lucide-react'
import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { CertificateManagementPageViewProps } from '../Types/certificate-management.types'
import CertificateDetailsModal from './CertificateDetailsModal'
import CertificateImportModal from './CertificateImportModal'
import CertificateRequestModal from './CertificateRequestModal'
import CertificatesTable from './CertificatesTable'

export default function CertificateManagementPageView({
    logic: { state, handler },
}: CertificateManagementPageViewProps) {
    const { t } = useTranslationStore()
    const pageAction = (
        <div className="flex flex-wrap gap-3">
            {state.canIssue ? (
                <button
                    type="button"
                    className={uiClassNames.button.secondary}
                    onClick={() => handler.openRequest()}
                    disabled={state.isMutating}
                >
                    {t('admin.certificates.actions.request')}
                </button>
            ) : null}
            {state.canCreate ? (
                <button
                    type="button"
                    className={uiClassNames.button.add}
                    onClick={handler.openImport}
                    disabled={state.isMutating}
                >
                    <Plus aria-hidden="true" className="size-4" />
                    {t('admin.certificates.actions.import')}
                </button>
            ) : null}
        </div>
    )
    return (
        <>
            <PageHeader
                eyebrow={t('admin.certificates.page.eyebrow')}
                title={t('admin.certificates.page.title')}
                description={t('admin.certificates.page.description')}
                action={pageAction}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.certificates.states.unavailableTitle')}
                    description={t('admin.certificates.states.unavailableDescription')}
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
                <CertificatesTable
                    loading={state.isLoading}
                    isPending={state.isMutating}
                    {...state}
                    onCreate={handler.openImport}
                    onRequest={() => handler.openRequest()}
                    onDetails={handler.openDetails}
                    onRenew={handler.openRenew}
                    onReplace={handler.openReplace}
                    onDelete={handler.openDelete}
                />
            )}
            {state.importOpen ? (
                <CertificateImportModal
                    open
                    onOpenChange={handler.setImportDialogOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.replaceTarget ? (
                <CertificateImportModal
                    key={state.replaceTarget.id}
                    open
                    certificate={state.replaceTarget}
                    onOpenChange={handler.setReplaceDialogOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.requestOpen ? (
                <CertificateRequestModal
                    key={
                        (state.requestDefaults.name ?? '') +
                        ':' +
                        (state.requestDefaults.domains ?? []).join(',')
                    }
                    open
                    {...(state.requestDefaults.name
                        ? { initialName: state.requestDefaults.name }
                        : {})}
                    {...(state.requestDefaults.domains
                        ? { initialDomains: state.requestDefaults.domains }
                        : {})}
                    onOpenChange={handler.setRequestDialogOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.detailsTarget ? (
                <CertificateDetailsModal
                    open
                    certificate={state.detailsTarget}
                    onOpenChange={handler.setDetailsDialogOpen}
                />
            ) : null}
            {state.renewTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setRenewDialogOpen}
                    title={t('admin.certificates.confirm.renewTitle', {
                        name: state.renewTarget.name,
                    })}
                    description={t('admin.certificates.confirm.renewDescription')}
                    confirmLabel={t('admin.certificates.actions.renew')}
                    pendingLabel={t('admin.certificates.actions.renewing')}
                    isPending={state.isRenewing}
                    onConfirm={handler.confirmRenew}
                />
            ) : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteDialogOpen}
                    title={t('admin.certificates.confirm.deleteTitle', {
                        name: state.deleteTarget.name,
                    })}
                    description={t('admin.certificates.confirm.deleteDescription')}
                    confirmLabel={t('admin.certificates.actions.delete')}
                    pendingLabel={t('admin.certificates.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}
