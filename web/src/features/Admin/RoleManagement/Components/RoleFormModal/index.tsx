import { Modal } from '@/shared/Modal/index.tsx'
import useRoleFormModalLogic from './Hooks/useRoleFormModalLogic.ts'
import type { RoleFormModalProps } from '../../Types/role-management-component-props.types.ts'
import RoleFormFields from './Components/RoleFormFields.tsx'
import RoleFormModalFooter from './Components/RoleFormModalFooter.tsx'

export default function RoleFormModal(props: RoleFormModalProps) {
    const { state, handler, form } = useRoleFormModalLogic(props)

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="lg"
            closeDisabled={state.isPending}
            footer={
                <RoleFormModalFooter {...state} form={form} onOpenChange={props.onOpenChange} />
            }
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <RoleFormFields
                    {...state}
                    form={form}
                    assignablePermissionKeys={props.assignablePermissionKeys}
                    role={props.role}
                />
            </form>
        </Modal>
    )
}
