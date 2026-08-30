import type { ReactNode } from 'react'

import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'

export interface ProxyHostsTableProps {
    readonly proxyHosts: ReadonlyArray<ProxyHostSummary>
    readonly loading: boolean
    readonly action?: ReactNode
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly canEnable: boolean
    readonly canDisable: boolean
    readonly isPending: boolean
    readonly onEdit: (host: ProxyHostSummary) => void
    readonly onDelete: (host: ProxyHostSummary) => void
    readonly onDisable: (host: ProxyHostSummary) => void
    readonly onEnable: (host: ProxyHostSummary) => void
}

export type ProxyHostTableActionProps = Pick<
    ProxyHostsTableProps,
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

export interface ProxyHostTableActionsProps extends ProxyHostTableActionProps {
    readonly host: ProxyHostSummary
}

export interface ProxyHostDomainsCellProps {
    readonly domains: ReadonlyArray<string>
}

export interface ProxyHostForwardCellProps {
    readonly forwardScheme: ProxyHostSummary['forwardScheme']
    readonly forwardHost: string
    readonly forwardPort: number
}

export interface ProxyHostStatusCellProps {
    readonly enabled: boolean
}

export interface ProxyHostCreatedAtCellProps {
    readonly value: unknown
}
