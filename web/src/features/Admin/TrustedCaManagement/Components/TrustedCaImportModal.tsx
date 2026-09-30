import { TextInput, Textarea } from '@rentnerkev/inputs'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { Modal } from '../../../../shared/Modal'
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
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={formId + '-name'}
                            >
                                {t('admin.trustedCas.form.name')}
                            </label>
                            <TextInput
                                id={formId + '-name'}
                                name={field.name}
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
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={formId + '-pem'}
                            >
                                {t('admin.trustedCas.form.pem')}
                            </label>
                            <Textarea
                                id={formId + '-pem'}
                                name={field.name}
                                className={
                                    'box-border w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-[0.55] focus:border-brand-600 focus:outline-hidden focus:ring-[3px] focus:ring-brand-500/20 motion-reduce:transition-none min-h-26 resize-y py-3' +
                                    ' min-h-52 font-mono text-xs'
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
                            <p
                                id={formId + '-pem-hint'}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
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
