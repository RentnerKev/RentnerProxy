import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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
                        className={uiClassNames.button.secondary}
                        disabled={state.isPending}
                        onClick={() => handler.handleOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className={uiClassNames.button.primary}
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
