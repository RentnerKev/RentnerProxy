import AccessPolicyManagementPageView from './Components/AccessPolicyManagementPageView'
import useAccessPolicyManagementLogic from './Hooks/useAccessPolicyManagementLogic'
import type { AccessPolicyManagementPageProps } from './Types/access-policy-management.types'

export default function AccessPolicyManagementPage(props: AccessPolicyManagementPageProps) {
    return <AccessPolicyManagementPageView logic={useAccessPolicyManagementLogic(props)} />
}
