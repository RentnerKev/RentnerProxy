import TrustedCaManagementPageView from './Components/TrustedCaManagementPageView'
import useTrustedCaManagementLogic from './Hooks/useTrustedCaManagementLogic'
import type { TrustedCaManagementPageProps } from './Types/trusted-ca-management.types'

export default function TrustedCaManagementPage(props: TrustedCaManagementPageProps) {
    return <TrustedCaManagementPageView logic={useTrustedCaManagementLogic(props)} />
}
