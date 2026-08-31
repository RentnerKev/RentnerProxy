import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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
