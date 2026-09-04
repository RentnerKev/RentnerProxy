import type { ReactNode } from 'react'
import type { RedirectHostSummary } from '../../../../shared/Types/redirect-hosts.types'
export interface RedirectHostsTableProps {
    readonly redirectHosts: ReadonlyArray<RedirectHostSummary>
    readonly loading: boolean
    readonly action?: ReactNode
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly canEnable: boolean
    readonly canDisable: boolean
    readonly isPending: boolean
    readonly onEdit: (host: RedirectHostSummary) => void
    readonly onDelete: (host: RedirectHostSummary) => void
    readonly onDisable: (host: RedirectHostSummary) => void
    readonly onEnable: (host: RedirectHostSummary) => void
}
export type RedirectHostTableActionProps = Pick<
    RedirectHostsTableProps,
    | 'canUpdate'
    | 'canDelete'
    | 'canEnable'
    | 'canDisable'
    | 'isPending'
    | 'onEdit'
    | 'onDelete'
    | 'onDisable'
    | 'onEnable'
>
export interface RedirectHostTableActionsProps extends RedirectHostTableActionProps {
    readonly host: RedirectHostSummary
}
export interface RedirectHostDomainsCellProps {
    readonly domains: ReadonlyArray<string>
}
export interface RedirectHostDestinationCellProps {
    readonly destination: string
    readonly statusCode: RedirectHostSummary['statusCode']
    readonly preserveRequestUri: boolean
    readonly certificateId: string | null
}
export interface RedirectHostCertificateCellProps {
    readonly certificateId: string | null
}
export interface RedirectHostStatusCellProps {
    readonly enabled: boolean
}
export interface RedirectHostCreatedAtCellProps {
    readonly value: unknown
}
