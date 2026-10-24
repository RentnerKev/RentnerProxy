import { ModalActionButton, ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
import type { CertificateRequestModalLogicResult } from './Types/certificate-request-modal.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useCertificateRequestModalLogic from './Hooks/useCertificateRequestModalLogic.ts'
import type { CertificateRequestModalProps } from './Types/certificate-request-modal.types.ts'
import CertificateRequestFields from './Components/CertificateRequestFields.tsx'
import { ACME_TERMS_INFORMATION_URL } from '@/config/certificates.config.ts'

export default function CertificateRequestModal(props: CertificateRequestModalProps) {
    const { state, handler, form }: CertificateRequestModalLogicResult =
        useCertificateRequestModalLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            size="lg"
            title={t('admin.certificates.request.title')}
            description={t('admin.certificates.request.description')}
            closeDisabled={state.isPending}
            footer={
                <>
                    {!state.retryableJob ? (
                        <p
                            id={`${state.formId}-acme-consent`}
                            className="m-0 w-full text-xs leading-relaxed text-muted"
                        >
                            {t('admin.certificates.request.submitConsent', {
                                action: t('admin.certificates.actions.request'),
                            })}{' '}
                            <a
                                href={ACME_TERMS_INFORMATION_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-accent-ring underline underline-offset-2"
                            >
                                {t('admin.certificates.request.termsLink')}
                            </a>
                            .
                        </p>
                    ) : null}
                    <ModalCancelButton
                        type="button"
                        disabled={state.isPending}
                        onClick={handler.handleClose}
                    />
                    <form.Subscribe
                        selector={(formState) =>
                            [formState.canSubmit, formState.isSubmitting] as const
                        }
                    >
                        {([canSubmit, isSubmitting]) => (
                            <ModalActionButton
                                type="submit"
                                form={state.formId}
                                aria-describedby={
                                    state.retryableJob ? undefined : `${state.formId}-acme-consent`
                                }
                                variant="primary"
                                disabled={
                                    !canSubmit ||
                                    isSubmitting ||
                                    state.isPending ||
                                    (state.jobActive && !state.retryableJob)
                                }
                            >
                                {state.isPending || isSubmitting
                                    ? t('admin.certificates.actions.requesting')
                                    : state.retryableJob
                                      ? t('admin.certificates.actions.retry')
                                      : t('admin.certificates.actions.request')}
                            </ModalActionButton>
                        )}
                    </form.Subscribe>
                </>
            }
        >
            {state.jobStage ? (
                <output className="mb-4 block text-sm font-semibold text-ink-soft">
                    {t(`admin.certificates.operationStages.${state.jobStage}`)}
                </output>
            ) : null}
            <form id={state.formId} noValidate onSubmit={handler.handleSubmit}>
                <CertificateRequestFields
                    form={form}
                    isPending={state.isPending}
                    readOnlyDomains={state.readOnlyDomains}
                />
            </form>
        </Modal>
    )
}
