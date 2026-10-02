import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import useRedirectHostFormModalLogic from './Hooks/useRedirectHostFormModalLogic.ts'
import type { RedirectHostFormModalProps } from './Types/redirect-host-form.types.ts'
import RedirectHostFormFields from './Components/RedirectHostFormFields.tsx'
import RedirectHostFormModalFooter from './Components/RedirectHostFormModalFooter.tsx'
export default function RedirectHostFormModal(props: RedirectHostFormModalProps) {
    const { state, handler, form } = useRedirectHostFormModalLogic(props)
    const { t } = useTranslationStore()
    return (
        <>
            <Modal
                open={props.open}
                onOpenChange={props.onOpenChange}
                title={state.title}
                description={state.description}
                size="lg"
                closeDisabled={state.isPending || state.disableConfirmationOpen}
                footer={
                    <RedirectHostFormModalFooter
                        {...state}
                        form={form}
                        onOpenChange={props.onOpenChange}
                    />
                }
            >
                <form
                    id={state.formId}
                    className="grid gap-4 shell:grid-cols-2 shell:items-start"
                    noValidate
                    onSubmit={handler.handleSubmit}
                >
                    <RedirectHostFormFields
                        {...state}
                        form={form}
                        addDomain={handler.addDomain}
                        removeDomain={handler.removeDomain}
                        retryAssignableCertificates={handler.retryAssignableCertificates}
                    />
                </form>
            </Modal>
            {state.disableConfirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDisableConfirmationOpen}
                    title={t('admin.redirectHosts.confirm.disableTitle')}
                    description={t('admin.redirectHosts.confirm.disableDescription')}
                    confirmLabel={t('admin.redirectHosts.confirm.saveDisabled')}
                    pendingLabel={t('common.saving')}
                    destructive
                    isPending={state.isPending}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}
