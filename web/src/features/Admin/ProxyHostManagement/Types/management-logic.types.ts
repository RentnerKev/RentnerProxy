import type { ProxyHostSummary } from '@/shared/Types/proxy-hosts.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/shared/Types/proxy-runtime.types.ts'

export interface ProxyHostManagementLogicResult {
    readonly state: {
        readonly canApply: boolean
        readonly canAssignCertificates: boolean
        readonly canAssignPolicies: boolean
        readonly canRequestCertificate: boolean
        readonly canCreateCertificateJob: boolean
        readonly canEditConfig: boolean
        readonly canCreate: boolean
        readonly canDelete: boolean
        readonly canDisable: boolean
        readonly canEnable: boolean
        readonly canUpdate: boolean
        readonly deleteTarget: ProxyHostSummary | null
        readonly disableTarget: ProxyHostSummary | null
        readonly isDeleting: boolean
        readonly isDisabling: boolean
        readonly isApplying: boolean
        readonly isMutating: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly proxyHosts: readonly ProxyHostSummary[]
        readonly runtimeStatus: ProxyRuntimeSyncStatus | undefined
        readonly runtimeStatusError: boolean
        readonly runtimeStatusRetrying: boolean
        readonly selectedProxyHost: ProxyHostSummary | null
        readonly showCreate: boolean
        readonly configTarget: ProxyHostSummary | null
        readonly globalConfigOpen: boolean
        readonly certificateRequestTarget: ProxyHostSummary | null
    }
    readonly handler: {
        readonly apply: () => void
        readonly confirmDelete: () => Promise<void>
        readonly confirmDisable: () => Promise<void>
        readonly enable: (value: ProxyHostSummary) => void
        readonly handleFormSuccess: () => void
        readonly handleCertificateRequestSuccess: () => void
        readonly openCreate: () => void
        readonly openConfigEditor: (value: ProxyHostSummary) => void
        readonly openCertificateRequest: (value: ProxyHostSummary) => void
        readonly setCertificateRequestOpen: (open: boolean) => void
        readonly setConfigEditorOpen: (open: boolean) => void
        readonly openGlobalConfig: () => void
        readonly setGlobalConfigEditorOpen: (open: boolean) => void
        readonly openDelete: (value: ProxyHostSummary) => void
        readonly openDisable: (value: ProxyHostSummary) => void
        readonly openEditor: (value: ProxyHostSummary) => void
        readonly retry: () => void
        readonly retryRuntime: () => void
        readonly setCreateOpen: (open: boolean) => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly setDisableOpen: (open: boolean) => void
        readonly setEditorOpen: (open: boolean) => void
    }
}
