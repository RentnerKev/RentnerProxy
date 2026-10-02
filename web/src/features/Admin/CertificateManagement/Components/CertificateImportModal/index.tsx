import type { CertificateImportLogicResult } from './Types/certificate-import-modal.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import type { CertificateImportModalProps } from './Types/certificate-import-modal.types.ts'
import useCertificateImportLogic from './Hooks/useCertificateImportLogic.ts'
import CertificateImportFields from './Components/CertificateImportFields.tsx'

export default function CertificateImportModal(props: CertificateImportModalProps) {
    const { state, handler, form }: CertificateImportLogicResult = useCertificateImportLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t(
                state.isReplace
                    ? 'admin.certificates.replace.title'
                    : 'admin.certificates.import.title',
            )}
            description={t(
                state.isReplace
                    ? 'admin.certificates.replace.description'
                    : 'admin.certificates.import.description',
            )}
            size="lg"
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
                                disabled={!canSubmit || isSubmitting || state.isPending}
                            >
                                {state.isPending || isSubmitting
                                    ? t('admin.certificates.actions.saving')
                                    : t(
                                          state.isReplace
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
                id={state.formId}
                noValidate
                className="grid gap-4"
                onSubmit={handler.handleSubmit}
            >
                <CertificateImportFields form={form} isPending={state.isPending} />
            </form>
        </Modal>
    )
}
