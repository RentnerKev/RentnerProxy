import type { CertificateRequestModalLogicResult } from './Types/certificate-request-modal.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useCertificateRequestModalLogic from './Hooks/useCertificateRequestModalLogic.ts'
import type { CertificateRequestModalProps } from './Types/certificate-request-modal.types.ts'
import CertificateRequestFields from './Components/CertificateRequestFields.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

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
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.isPending}
                        onClick={handler.handleClose}
                    >
                        {t('common.cancel')}
                    </button>
                    <form.Subscribe
                        selector={(formState) =>
                            [formState.canSubmit, formState.isSubmitting] as const
                        }
                    >
                        {([canSubmit, isSubmitting]) => (
                            <button
                                type="submit"
                                form={state.formId}
                                className={buttonClassName('primary')}
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
                            </button>
                        )}
                    </form.Subscribe>
                </>
            }
        >
            <div className="mb-4 rounded-xl border border-info-text/20 bg-info-bg p-3 text-sm leading-relaxed text-info-text">
                {t('admin.certificates.request.networkHint')}
                {state.jobStage ? (
                    <span className="mt-2 block font-semibold">
                        {t(`admin.certificates.operationStages.${state.jobStage}`)}
                    </span>
                ) : null}
            </div>
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
