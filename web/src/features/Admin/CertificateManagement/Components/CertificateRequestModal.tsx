import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { isCertificateJobActive } from '../../../../config/certificate-jobs.config'
import useCertificateRequestLogic from '../Hooks/useCertificateRequestLogic'
import type { CertificateRequestModalProps } from '../Types/certificate-management.types'
import CertificateRequestFields from './CertificateRequestFields'

export default function CertificateRequestModal(props: CertificateRequestModalProps) {
    const { form, formId, isPending, readOnlyDomains, retryableJob } =
        useCertificateRequestLogic(props)
    const { t } = useTranslationStore()
    const job = props.certificateJob
    const jobActive = job ? isCertificateJobActive(job.stage) : false
    const jobStage =
        job?.controllerStage ??
        (job
            ? (
                  {
                      preparing: 'queued',
                      issuing: 'creating_order',
                      applying: 'applying',
                      applied: 'applied',
                      failed: 'failed',
                      needs_attention: 'needs_attention',
                  } as const
              )[job.stage]
            : null)
    const canRetry = retryableJob
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            size="lg"
            title={t('admin.certificates.request.title')}
            description={t('admin.certificates.request.description')}
            closeDisabled={isPending}
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        disabled={isPending}
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <form.Subscribe
                        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
                    >
                        {([canSubmit, isSubmitting]) => (
                            <button
                                type="submit"
                                form={formId}
                                className={uiClassNames.button.primary}
                                disabled={
                                    !canSubmit ||
                                    isSubmitting ||
                                    isPending ||
                                    (jobActive && !canRetry)
                                }
                            >
                                {isPending || isSubmitting
                                    ? t('admin.certificates.actions.requesting')
                                    : retryableJob
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
                {jobStage ? (
                    <span className="mt-2 block font-semibold">
                        {t(`admin.certificates.operationStages.${jobStage}`)}
                    </span>
                ) : null}
            </div>
            <form
                id={formId}
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void form.handleSubmit()
                }}
            >
                <CertificateRequestFields
                    form={form}
                    isPending={isPending}
                    readOnlyDomains={readOnlyDomains}
                />
            </form>
        </Modal>
    )
}
