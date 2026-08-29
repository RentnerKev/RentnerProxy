import UserManagementPageView from './Components/UserManagementPageView'
import useUserManagementLogic from './Hooks/useUserManagementLogic'
import type { UserManagementPageProps } from './Types/user-management-component-props.types'

export default function UserManagementPage(props: UserManagementPageProps) {
    return (
        <UserManagementPageView
            currentUserId={props.currentUserId}
            logic={useUserManagementLogic(props)}
        />
    )
}
