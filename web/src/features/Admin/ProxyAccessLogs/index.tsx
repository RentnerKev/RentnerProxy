import ProxyAccessLogsPageView from './Components/ProxyAccessLogsPageView'
import useProxyAccessLogsLogic from './Hooks/useProxyAccessLogsLogic'
import type { ProxyAccessLogsPageProps } from './Types/proxy-access-logs.types'

export default function ProxyAccessLogsPage(props: ProxyAccessLogsPageProps) {
    return <ProxyAccessLogsPageView logic={useProxyAccessLogsLogic(props)} />
}
