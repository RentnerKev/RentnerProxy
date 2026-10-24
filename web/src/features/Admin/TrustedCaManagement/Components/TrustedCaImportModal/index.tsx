import { ModalActionButton, ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
import type { TrustedCaImportLogicResult } from './Types/trusted-ca-import-modal.types.ts'
import { TextInput, Textarea } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import { Modal } from '@/shared/Modal/index.tsx'
import useTrustedCaImportLogic from './Hooks/useTrustedCaImportLogic.ts'
import type { TrustedCaImportModalProps } from './Types/trusted-ca-import-modal.types.ts'

export default function TrustedCaImportModal(props: TrustedCaImportModalProps) {
    const { state, handler, form }: TrustedCaImportLogicResult = useTrustedCaImportLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t(
                state.isReplace
                    ? 'admin.trustedCas.replace.title'
                    : 'admin.trustedCas.import.title',
            )}
            description={t(
                state.isReplace
                    ? 'admin.trustedCas.replace.description'
                    : 'admin.trustedCas.import.description',
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
                                {t(
                                    state.isPending || isSubmitting
                                        ? 'common.saving'
                                        : state.isReplace
                                          ? 'admin.trustedCas.actions.replace'
                                          : 'admin.trustedCas.actions.import',
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
                <form.Field name="name">
                    {(field) => (
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={state.formId + '-name'}
                            >
                                {t('admin.trustedCas.form.name')}
                            </label>
                            <TextInput
                                id={state.formId + '-name'}
                                placeholder={t('placeholders.trustedCaName')}
                                name={field.name}
                                value={field.state.value}
                                maxLength={120}
                                disabled={state.isPending}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={state.formId + '-name-error'}
                            />
                            <FieldError
                                id={state.formId + '-name-error'}
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
                                htmlFor={state.formId + '-pem'}
                            >
                                {t('admin.trustedCas.form.pem')}
                            </label>
                            <Textarea
                                id={state.formId + '-pem'}
                                placeholder={t('placeholders.trustedCaPem')}
                                name={field.name}
                                className={
                                    'box-border w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-[0.55] focus:border-accent-border focus:outline-hidden focus:ring-[3px] focus:ring-accent-ring/20 motion-reduce:transition-none min-h-26 resize-y py-3' +
                                    ' min-h-52 font-mono text-xs'
                                }
                                value={field.state.value}
                                maxLength={256 * 1024}
                                disabled={state.isPending}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                autoCapitalize="off"
                                autoComplete="off"
                                spellCheck={false}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={
                                    state.formId + '-pem-hint ' + state.formId + '-pem-error'
                                }
                            />
                            <p
                                id={state.formId + '-pem-hint'}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.trustedCas.form.pemHint')}
                            </p>
                            <FieldError
                                id={state.formId + '-pem-error'}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
            </form>
        </Modal>
    )
}
