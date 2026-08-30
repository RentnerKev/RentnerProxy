import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import useProxyHostFormModal from '../Hooks/useProxyHostFormModal'
import type { ProxyHostFormModalProps } from '../Types/proxy-host-form.types'
import ProxyHostFormFields from './ProxyHostFormFields'
import ProxyHostFormModalFooter from './ProxyHostFormModalFooter'

export default function ProxyHostFormModal(props: ProxyHostFormModalProps) {
    const { state, handler } = useProxyHostFormModal(props)
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
                footer={<ProxyHostFormModalFooter {...state} onOpenChange={props.onOpenChange} />}
            >
                <form
                    id={state.formId}
                    className="grid gap-4 shell:grid-cols-2 shell:items-start"
                    noValidate
                    onSubmit={handler.handleSubmit}
                >
                    <ProxyHostFormFields
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
                    title={t('admin.proxyHosts.confirm.disableTitle')}
                    description={t('admin.proxyHosts.confirm.disableDescription')}
                    confirmLabel={t('admin.proxyHosts.confirm.saveDisabled')}
                    pendingLabel={t('common.saving')}
                    destructive
                    isPending={state.isPending}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}
