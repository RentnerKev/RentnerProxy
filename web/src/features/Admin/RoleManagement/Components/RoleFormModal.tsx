import { Modal } from '../../../../shared/Modal'
import useRoleFormModal from '../Hooks/useRoleFormModal'
import type { RoleFormModalProps } from '../Types/role-management-component-props.types'
import RoleFormFields from './RoleFormFields'
import RoleFormModalFooter from './RoleFormModalFooter'

export default function RoleFormModal(props: RoleFormModalProps) {
    const { state, handler } = useRoleFormModal(props)

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="lg"
            closeDisabled={state.isPending}
            footer={<RoleFormModalFooter {...state} onOpenChange={props.onOpenChange} />}
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <RoleFormFields
                    {...state}
                    assignablePermissionKeys={props.assignablePermissionKeys}
                    role={props.role}
                />
            </form>
        </Modal>
    )
}
