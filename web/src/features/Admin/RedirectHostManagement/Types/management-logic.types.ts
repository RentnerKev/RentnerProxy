import type { RedirectHostSummary } from '@/shared/Types/redirect-hosts.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/shared/Types/proxy-runtime.types.ts'

export interface RedirectHostManagementLogicResult {
    readonly state: {
        readonly canApply: boolean
        readonly canCreate: boolean
        readonly canDelete: boolean
        readonly canDisable: boolean
        readonly canEnable: boolean
        readonly canUpdate: boolean
        readonly canAssignCertificates: boolean
        readonly deleteTarget: RedirectHostSummary | null
        readonly disableTarget: RedirectHostSummary | null
        readonly isDeleting: boolean
        readonly isDisabling: boolean
        readonly isApplying: boolean
        readonly isMutating: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly redirectHosts: readonly RedirectHostSummary[]
        readonly runtimeStatus: ProxyRuntimeSyncStatus | undefined
        readonly runtimeStatusError: boolean
        readonly runtimeStatusRetrying: boolean
        readonly selected: RedirectHostSummary | null
        readonly showCreate: boolean
    }
    readonly handler: {
        readonly apply: () => void
        readonly confirmDelete: () => Promise<void>
        readonly confirmDisable: () => Promise<void>
        readonly enable: (value: RedirectHostSummary) => void
        readonly handleFormSuccess: () => void
        readonly openCreate: () => void
        readonly openDelete: (value: RedirectHostSummary) => void
        readonly openDisable: (value: RedirectHostSummary) => void
        readonly openEditor: (value: RedirectHostSummary) => void
        readonly retry: () => void
        readonly retryRuntime: () => void
        readonly setCreateOpen: (open: boolean) => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly setDisableOpen: (open: boolean) => void
        readonly setEditorOpen: (open: boolean) => void
    }
}
