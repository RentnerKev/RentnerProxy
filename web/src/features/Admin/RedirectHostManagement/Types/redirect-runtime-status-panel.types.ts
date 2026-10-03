import type { RedirectRuntimeStatus } from './redirect-host-management.types.ts'

export interface Props {
    readonly canApply: boolean
    readonly isError?: boolean
    readonly isApplying: boolean
    readonly isRetrying?: boolean
    readonly onApply: () => void
    readonly onRetry?: () => void
    readonly status: RedirectRuntimeStatus | undefined
}
