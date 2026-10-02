import { Modal } from '@/shared/Modal/index.tsx'
import useUserFormModalLogic from './Hooks/useUserFormModalLogic.ts'
import type { UserFormModalProps } from '../../Types/user-management-component-props.types.ts'
import UserFormFields from './Components/UserFormFields.tsx'
import UserFormModalFooter from './Components/UserFormModalFooter.tsx'

export default function UserFormModal(props: UserFormModalProps) {
    const { state, handler, form } = useUserFormModalLogic(props)

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="md"
            closeDisabled={state.isPending}
            footer={
                <UserFormModalFooter {...state} form={form} onOpenChange={props.onOpenChange} />
            }
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <UserFormFields {...state} form={form} roles={props.roles} user={props.user} />
            </form>
        </Modal>
    )
}
