import AuditLogsPageView from './Components/AuditLogsPageView'
import useAuditLogsLogic from './Hooks/useAuditLogsLogic'
import type { AuditLogsPageProps } from './Types/audit-logs.types'

export default function AuditLogsPage(props: AuditLogsPageProps) {
    return <AuditLogsPageView logic={useAuditLogsLogic(props)} />
}
