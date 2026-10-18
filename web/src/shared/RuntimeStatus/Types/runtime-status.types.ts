import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface RuntimeStatusPanelProps {
    readonly translationPrefix: string
    readonly showStatusDot?: boolean
    readonly canApply: boolean
    readonly isError?: boolean
    readonly isApplying: boolean
    readonly isRetrying?: boolean
    readonly onApply: () => void
    readonly onRetry?: () => void
    readonly status: ProxyRuntimeSyncStatus | undefined
}

export interface RuntimeStatusPanelLogicResult {
    readonly state: {
        readonly runtimeState: ProxyRuntimeSyncStatus['state']
        readonly showApply: boolean
        readonly hidden: boolean
    }
}
