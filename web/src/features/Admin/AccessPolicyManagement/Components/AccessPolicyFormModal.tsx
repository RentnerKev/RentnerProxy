import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { AccessPolicyFormModalProps } from '../Types/access-policy-form.types'
import useAccessPolicyFormModal from '../Hooks/useAccessPolicyFormModal'
import AccessPolicyFormFields from './AccessPolicyFormFields'

export default function AccessPolicyFormModal(props: AccessPolicyFormModalProps) {
    const { state, handler } = useAccessPolicyFormModal(props)
    const { t } = useTranslationStore()

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="md"
            closeDisabled={state.isPending}
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        disabled={state.isPending}
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className={uiClassNames.button.primary}
                        disabled={state.isPending}
                    >
                        {state.isPending ? state.pendingSubmitLabel : state.submitLabel}
                    </button>
                </>
            }
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <AccessPolicyFormFields
                    errors={state.errors}
                    formId={state.formId}
                    isPending={state.isPending}
                    setCombination={handler.setCombination}
                    setMode={handler.setMode}
                    setName={handler.setName}
                    values={state.values}
                />
            </form>
        </Modal>
    )
}
