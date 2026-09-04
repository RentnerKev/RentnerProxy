import RedirectHostManagementPageView from './Components/RedirectHostManagementPageView'
import useRedirectHostManagementLogic from './Hooks/useRedirectHostManagementLogic'
import type { RedirectHostManagementPageProps } from './Types/redirect-host-management.types'
export default function RedirectHostManagementPage(props: RedirectHostManagementPageProps) {
    return <RedirectHostManagementPageView logic={useRedirectHostManagementLogic(props)} />
}
