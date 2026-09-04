import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import useRedirectHostFormModal from '../Hooks/useRedirectHostFormModal'
import type { RedirectHostFormModalProps } from '../Types/redirect-host-form.types'
import RedirectHostFormFields from './RedirectHostFormFields'
import RedirectHostFormModalFooter from './RedirectHostFormModalFooter'
export default function RedirectHostFormModal(props: RedirectHostFormModalProps) {
    const { state, handler } = useRedirectHostFormModal(props)
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
                    <RedirectHostFormModalFooter {...state} onOpenChange={props.onOpenChange} />
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
                        addDomain={handler.addDomain}
                        removeDomain={handler.removeDomain}
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
