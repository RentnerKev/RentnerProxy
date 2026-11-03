import type { ProxyRuntimeStatus } from './proxy-host-management.types.ts'

export interface ProxyRuntimeStatusPanelProps {
    readonly canApply: boolean
    readonly isError?: boolean
    readonly isApplying: boolean
    readonly onApply: () => void
    readonly status: ProxyRuntimeStatus | undefined
}
