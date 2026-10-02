import type { ProxyHostSummary } from '@/shared/Types/proxy-hosts.types.ts'

export interface ProxyHostTableActionInputs {
    readonly canDelete: boolean
    readonly canDisable: boolean
    readonly canRequestCertificate?: boolean
    readonly canEnable: boolean
    readonly canUpdate: boolean
    readonly isPending: boolean
    readonly host: ProxyHostSummary
    readonly onDelete: (value: ProxyHostSummary) => void
    readonly onDisable: (value: ProxyHostSummary) => void
    readonly onEdit: (value: ProxyHostSummary) => void
    readonly onEnable: (value: ProxyHostSummary) => void
    readonly onConfig?: (value: ProxyHostSummary) => void
    readonly onRequestCertificate?: (value: ProxyHostSummary) => void
}
