import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface AccessPolicyManagementLogicResult {
    readonly state: {
        readonly canApply: boolean
        readonly canCreate: boolean
        readonly canDelete: boolean
        readonly canViewCredentials: boolean
        readonly canUpdate: boolean
        readonly credentialsPolicy: AccessPolicySummary | null
        readonly deleteTarget: AccessPolicySummary | null
        readonly isApplying: boolean
        readonly isDeleting: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly isMutating: boolean
        readonly policies: readonly AccessPolicySummary[]
        readonly runtimeStatus: ProxyRuntimeSyncStatus | undefined
        readonly runtimeStatusError: boolean
        readonly runtimeStatusRetrying: boolean
        readonly selectedPolicy: AccessPolicySummary | null
        readonly showCreate: boolean
    }
    readonly handler: {
        readonly apply: () => void
        readonly confirmDelete: () => Promise<void>
        readonly handleFormSuccess: () => void
        readonly handleAccountsChange: () => Promise<void>
        readonly openCreate: () => void
        readonly openCredentials: (value: AccessPolicySummary) => void
        readonly openDelete: (value: AccessPolicySummary) => void
        readonly openEditor: (value: AccessPolicySummary) => void
        readonly retry: () => void
        readonly retryRuntime: () => void
        readonly setCreateOpen: (open: boolean) => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly setEditorOpen: (open: boolean) => void
        readonly setCredentialsOpen: (open: boolean) => void
    }
}
