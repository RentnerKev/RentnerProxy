import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import useBasicAuthAccountFormLogic from '../Hooks/useBasicAuthAccountFormLogic'
import type { BasicAuthAccountFormModalProps } from '../Types/basic-auth.types'
import BasicAuthAccountFormFields from './BasicAuthAccountFormFields'

export default function BasicAuthAccountFormModal(props: BasicAuthAccountFormModalProps) {
    const { state, handler } = useBasicAuthAccountFormLogic(props)
    const { t } = useTranslationStore()
    const isCreate = props.mode === 'create'

    return (
        <Modal
            open={props.open}
            onOpenChange={handler.handleOpenChange}
            title={t(
                isCreate
                    ? 'admin.accessPolicies.basicAuth.form.createTitle'
                    : 'admin.accessPolicies.basicAuth.form.editTitle',
            )}
            description={t('admin.accessPolicies.basicAuth.form.description')}
            size="sm"
            closeDisabled={state.isPending}
            footer={
                <>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
                        disabled={state.isPending}
                        onClick={() => handler.handleOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        disabled={state.isPending}
                    >
                        {state.isPending
                            ? t('admin.accessPolicies.basicAuth.actions.saving')
                            : t(
                                  isCreate
                                      ? 'admin.accessPolicies.basicAuth.actions.create'
                                      : 'admin.accessPolicies.basicAuth.actions.save',
                              )}
                    </button>
                </>
            }
        >
            <div className="mb-4 rounded-xl border border-info-text/20 bg-info-bg p-3 text-sm leading-relaxed text-info-text">
                {t('admin.accessPolicies.basicAuth.form.transportHint')}
            </div>
            <form
                id={state.formId}
                className="grid gap-4"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void handler.submit()
                }}
            >
                <BasicAuthAccountFormFields
                    errors={state.errors}
                    formId={state.formId}
                    isPending={state.isPending}
                    mode={props.mode}
                    setPassword={handler.setPassword}
                    setUsername={handler.setUsername}
                    values={state.values}
                />
            </form>
        </Modal>
    )
}
