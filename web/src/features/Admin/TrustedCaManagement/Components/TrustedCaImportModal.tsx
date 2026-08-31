import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useTrustedCaImportLogic from '../Hooks/useTrustedCaImportLogic'
import type { TrustedCaImportModalProps } from '../Types/trusted-ca-management.types'

export default function TrustedCaImportModal(props: TrustedCaImportModalProps) {
    const { form, formId, isPending } = useTrustedCaImportLogic(props)
    const { t } = useTranslationStore()
    const isReplace = props.trustedCa !== undefined
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t(
                isReplace ? 'admin.trustedCas.replace.title' : 'admin.trustedCas.import.title',
            )}
            description={t(
                isReplace
                    ? 'admin.trustedCas.replace.description'
                    : 'admin.trustedCas.import.description',
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
                                {t(
                                    isPending || isSubmitting
                                        ? 'common.saving'
                                        : isReplace
                                          ? 'admin.trustedCas.actions.replace'
                                          : 'admin.trustedCas.actions.import',
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
                <form.Field name="name">
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={formId + '-name'}>
                                {t('admin.trustedCas.form.name')}
                            </label>
                            <input
                                id={formId + '-name'}
                                name={field.name}
                                className={uiClassNames.form.control}
                                value={field.state.value}
                                maxLength={120}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={formId + '-name-error'}
                            />
                            <FieldError
                                id={formId + '-name-error'}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field name="pem">
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={formId + '-pem'}>
                                {t('admin.trustedCas.form.pem')}
                            </label>
                            <textarea
                                id={formId + '-pem'}
                                name={field.name}
                                className={
                                    uiClassNames.form.textarea + ' min-h-52 font-mono text-xs'
                                }
                                value={field.state.value}
                                maxLength={256 * 1024}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                autoCapitalize="off"
                                autoComplete="off"
                                spellCheck={false}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={formId + '-pem-hint ' + formId + '-pem-error'}
                            />
                            <p id={formId + '-pem-hint'} className={uiClassNames.form.hint}>
                                {t('admin.trustedCas.form.pemHint')}
                            </p>
                            <FieldError
                                id={formId + '-pem-error'}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
            </form>
        </Modal>
    )
}
