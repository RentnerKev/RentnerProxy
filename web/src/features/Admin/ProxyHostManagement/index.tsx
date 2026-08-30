import ProxyHostManagementPageView from './Components/ProxyHostManagementPageView'
import useProxyHostManagementLogic from './Hooks/useProxyHostManagementLogic'
import type { ProxyHostManagementPageProps } from './Types/proxy-host-management.types'

export default function ProxyHostManagementPage(props: ProxyHostManagementPageProps) {
    return <ProxyHostManagementPageView logic={useProxyHostManagementLogic(props)} />
}
