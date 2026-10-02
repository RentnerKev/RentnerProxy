import type { CertificateRequestModalLogicResult } from './Types/certificate-request-modal.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useCertificateRequestModalLogic from './Hooks/useCertificateRequestModalLogic.ts'
import type { CertificateRequestModalProps } from './Types/certificate-request-modal.types.ts'
import CertificateRequestFields from './Components/CertificateRequestFields.tsx'

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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
