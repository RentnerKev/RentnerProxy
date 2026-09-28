import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import type { CertificateImportModalProps } from '../Types/certificate-management.types'
import useCertificateImportLogic from '../Hooks/useCertificateImportLogic'
import CertificateImportFields from './CertificateImportFields'

export default function CertificateImportModal(props: CertificateImportModalProps) {
    const { form, formId, isPending } = useCertificateImportLogic(props)
    const { t } = useTranslationStore()
    const isReplace = props.certificate !== undefined
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t(
                isReplace ? 'admin.certificates.replace.title' : 'admin.certificates.import.title',
            )}
            description={t(
                isReplace
                    ? 'admin.certificates.replace.description'
                    : 'admin.certificates.import.description',
            )}
            size="lg"
            closeDisabled={isPending}
            footer={
                <>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
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
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-brand-500 text-navy-950 enabled:hover:bg-brand-300"
                                disabled={!canSubmit || isSubmitting || isPending}
                            >
                                {isPending || isSubmitting
                                    ? t('admin.certificates.actions.saving')
                                    : t(
                                          isReplace
                                              ? 'admin.certificates.actions.replace'
                                              : 'admin.certificates.actions.import',
                                      )}
                            </button>
                        )}
                    </form.Subscribe>
                </>
            }
        >
            <form
                id={formId}
                noValidate
                className="grid gap-4"
                onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void form.handleSubmit()
                }}
            >
                <CertificateImportFields form={form} isPending={isPending} />
            </form>
        </Modal>
    )
}
