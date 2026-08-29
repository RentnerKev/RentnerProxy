import RoleManagementPageView from './Components/RoleManagementPageView'
import useRoleManagementLogic from './Hooks/useRoleManagementLogic'
import type { RoleManagementPageProps } from './Types/role-management-component-props.types'

export default function RoleManagementPage(props: RoleManagementPageProps) {
    return (
        <RoleManagementPageView
            currentUserRoleKeys={props.currentUserRoleKeys}
            logic={useRoleManagementLogic(props)}
        />
    )
}
