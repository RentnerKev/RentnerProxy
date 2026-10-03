import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { TrustedCaSummary } from '@/lib/Admin/TrustedCaManagement/Types/trusted-cas.types.ts'

export interface TrustedCaManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface TrustedCaManagementLogicResult {
    readonly state: {
        readonly trustedCas: readonly TrustedCaSummary[]
        readonly canCreate: boolean
        readonly canUpdate: boolean
        readonly canDelete: boolean
        readonly isLoading: boolean
        readonly isError: boolean
        readonly isMutating: boolean
        readonly importOpen: boolean
        readonly replaceTarget: TrustedCaSummary | null
        readonly deleteTarget: TrustedCaSummary | null
    }
    readonly handler: {
        readonly handleFormSuccess: () => Promise<void>
        readonly openImport: () => void
        readonly openReplace: (trustedCa: TrustedCaSummary) => void
        readonly openDelete: (trustedCa: TrustedCaSummary) => void
        readonly setImportOpen: (open: boolean) => void
        readonly setReplaceOpen: (open: boolean) => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly confirmDelete: () => Promise<void>
        readonly retry: () => void
    }
}
