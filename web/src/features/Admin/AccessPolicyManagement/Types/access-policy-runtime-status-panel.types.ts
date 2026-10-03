import type { AccessPolicyRuntimeStatus } from './access-policy-management.types.ts'

export interface AccessPolicyRuntimeStatusPanelProps {
    readonly canApply: boolean
    readonly isApplying: boolean
    readonly isError?: boolean
    readonly isRetrying?: boolean
    readonly onApply: () => void
    readonly onRetry?: () => void
    readonly status: AccessPolicyRuntimeStatus | undefined
}
