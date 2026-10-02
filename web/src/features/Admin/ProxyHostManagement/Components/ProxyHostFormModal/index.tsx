import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import useProxyHostFormModalLogic from './Hooks/useProxyHostFormModalLogic.ts'
import type { ProxyHostFormModalProps } from './Types/proxy-host-form.types.ts'
import ProxyHostFormFields from './Components/ProxyHostFormFields.tsx'
import ProxyHostFormModalFooter from './Components/ProxyHostFormModalFooter.tsx'

export default function ProxyHostFormModal(props: ProxyHostFormModalProps) {
    const { state, handler, form, certificateRequestForm } = useProxyHostFormModalLogic(props)
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
                    <ProxyHostFormModalFooter
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
                    <ProxyHostFormFields
                        certificateRequestForm={certificateRequestForm}
                        {...state}
                        form={form}
                        addDomain={handler.addDomain}
                        removeDomain={handler.removeDomain}
                        retryAssignableAccessPolicies={handler.retryAssignableAccessPolicies}
                        retryAssignableCertificates={handler.retryAssignableCertificates}
                        setRequestNewCertificate={handler.setRequestNewCertificate}
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
