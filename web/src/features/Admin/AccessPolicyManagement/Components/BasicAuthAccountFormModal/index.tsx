import { ModalCancelButton, ModalSaveButton } from '@/shared/Modal/Components/ModalActions.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useBasicAuthAccountFormLogic from './Hooks/useBasicAuthAccountFormLogic.ts'
import type { BasicAuthAccountFormModalProps } from '../../Types/basic-auth.types.ts'
import BasicAuthAccountFormFields from './Components/BasicAuthAccountFormFields.tsx'

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
                    <ModalCancelButton
                        type="button"
                        disabled={state.isPending}
                        onClick={() => handler.handleOpenChange(false)}
                    />
                    <ModalSaveButton
                        form={state.formId}
                        isPending={state.isPending}
                        disabled={state.isPending}
                    />
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
