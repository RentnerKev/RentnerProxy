import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { Info } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import useProxyHostFormModalLogic from './Hooks/useProxyHostFormModalLogic.ts'
import type { ProxyHostFormModalProps } from './Types/proxy-host-form.types.ts'
import ProxyHostSetupGuide from './Components/ProxyHostSetupGuide.tsx'
import ProxyHostFormFields from './Components/ProxyHostFormFields.tsx'
import ProxyHostFormModalFooter from './Components/ProxyHostFormModalFooter.tsx'
import HostTagSelect from '@/features/Admin/HostTags/Components/HostTagSelect.tsx'

export default function ProxyHostFormModal(props: ProxyHostFormModalProps) {
    const { state, handler, refs, form, certificateRequestForm } = useProxyHostFormModalLogic(props)
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
                    <>
                        <div className="mr-auto shrink-0">
                            <CustomTooltip
                                collisionPadding={10}
                                content={t(
                                    state.guide.open
                                        ? 'admin.proxyHosts.guide.skip'
                                        : 'admin.proxyHosts.guide.open',
                                )}
                            >
                                <button
                                    type="button"
                                    className="inline-flex size-12 cursor-pointer items-center justify-center rounded-xl border border-transparent text-muted transition-colors hover:border-accent-border hover:bg-accent-muted hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label={t(
                                        state.guide.open
                                            ? 'admin.proxyHosts.guide.skip'
                                            : 'admin.proxyHosts.guide.open',
                                    )}
                                    aria-expanded={state.guide.open}
                                    aria-controls={
                                        state.guide.open ? `${state.formId}-guide` : undefined
                                    }
                                    disabled={state.isPending}
                                    onClick={handler.handleToggleGuide}
                                >
                                    <Info aria-hidden="true" className="size-5" strokeWidth={1.8} />
                                </button>
                            </CustomTooltip>
                        </div>
                        <ProxyHostFormModalFooter
                            {...state}
                            form={form}
                            onOpenChange={props.onOpenChange}
                        />
                    </>
                }
            >
                <form
                    id={state.formId}
                    className="grid gap-4 shell:grid-cols-2 shell:items-start"
                    noValidate
                    onSubmit={handler.handleSubmit}
                >
                    <ProxyHostSetupGuide
                        guide={state.guide}
                        guideHeading={refs.guideHeading}
                        formId={state.formId}
                        handleNextGuideStep={handler.handleNextGuideStep}
                        handlePreviousGuideStep={handler.handlePreviousGuideStep}
                    />
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
                    <form.Field name="tagIds">
                        {(field) => (
                            <HostTagSelect
                                kind="proxy"
                                value={field.state.value ?? []}
                                onChange={field.handleChange}
                                disabled={state.isPending}
                            />
                        )}
                    </form.Field>
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
