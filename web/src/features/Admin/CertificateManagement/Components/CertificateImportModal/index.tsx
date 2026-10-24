import { ModalActionButton, ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
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
                                variant="primary"
                                disabled={!canSubmit || isSubmitting || state.isPending}
                            >
                                {state.isPending || isSubmitting
                                    ? t('admin.certificates.actions.saving')
                                    : t(
                                          state.isReplace
                                              ? 'admin.certificates.actions.replace'
                                              : 'admin.certificates.actions.import',
                                      )}
                            </ModalActionButton>
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
