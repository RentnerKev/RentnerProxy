import { Modal } from '../../../../shared/Modal'
import useUserFormModal from '../Hooks/useUserFormModal'
import type { UserFormModalProps } from '../Types/user-management-component-props.types'
import UserFormFields from './UserFormFields'
import UserFormModalFooter from './UserFormModalFooter'

export default function UserFormModal(props: UserFormModalProps) {
    const { state, handler } = useUserFormModal(props)

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="md"
            closeDisabled={state.isPending}
            footer={<UserFormModalFooter {...state} onOpenChange={props.onOpenChange} />}
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <UserFormFields {...state} roles={props.roles} user={props.user} />
            </form>
        </Modal>
    )
}
