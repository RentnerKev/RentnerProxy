import { Plus } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import type { CertificateManagementPageProps } from '../../Types/certificate-management.types.ts'
import useServerCertificatesLogic from './Hooks/useServerCertificatesLogic.ts'
import CertificateDetailsModal from '../CertificateDetailsModal/index.tsx'
import CertificateImportModal from '../CertificateImportModal/index.tsx'
import CertificateRequestModal from '../CertificateRequestModal/index.tsx'
import CertificatesTable from '../CertificatesTable/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function ServerCertificates(props: CertificateManagementPageProps) {
    const { state, handler } = useServerCertificatesLogic(props)
    const { t } = useTranslationStore()
    const pageAction = (
        <div className="flex flex-wrap gap-3">
            {state.canIssue ? (
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={() => handler.openRequest()}
                    disabled={state.isMutating}
                >
                    {t('admin.certificates.actions.request')}
                </button>
            ) : null}
            {state.canCreate ? (
                <button
                    type="button"
                    className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
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
                action={state.isError ? pageAction : undefined}
            />
            {state.isError ? (
                <PageAlert
                    severity="error"
                    title={t('admin.certificates.states.unavailableTitle')}
                    description={t('admin.certificates.states.unavailableDescription')}
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
                    canIssue={state.canIssue}
                    canRenew={state.canRenew}
                    onOpenChange={handler.setDetailsDialogOpen}
                />
            ) : null}
            {state.renewTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setRenewDialogOpen}
                    title={t(
                        state.renewTarget.candidate
                            ? 'admin.certificates.confirm.retryTitle'
                            : 'admin.certificates.confirm.renewTitle',
                        { name: state.renewTarget.name },
                    )}
                    description={t(
                        state.renewTarget.candidate
                            ? 'admin.certificates.confirm.retryDescription'
                            : 'admin.certificates.confirm.renewDescription',
                    )}
                    confirmLabel={t(
                        state.renewTarget.candidate
                            ? 'admin.certificates.actions.retry'
                            : 'admin.certificates.actions.renew',
                    )}
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
                    description={t(
                        state.deleteTarget.assignedHostCount > 0
                            ? 'admin.certificates.confirm.deleteAssignedDescription'
                            : 'admin.certificates.confirm.deleteDescription',
                        { count: state.deleteTarget.assignedHostCount },
                    )}
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
