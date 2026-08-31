import type { PermissionKey } from '../../../../config/permissions.config'
import type { TrustedCaSummary } from '../../../../shared/Types/trusted-cas.types'
import type useTrustedCaManagementLogic from '../Hooks/useTrustedCaManagementLogic'

export interface TrustedCaManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface TrustedCaManagementPageViewProps {
    readonly logic: ReturnType<typeof useTrustedCaManagementLogic>
}

export interface TrustedCaTableProps {
    readonly trustedCas: ReadonlyArray<TrustedCaSummary>
    readonly loading: boolean
    readonly canCreate: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onCreate: () => void
    readonly onReplace: (trustedCa: TrustedCaSummary) => void
    readonly onDelete: (trustedCa: TrustedCaSummary) => void
}

export interface TrustedCaImportModalProps {
    readonly trustedCa?: TrustedCaSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void | Promise<void>
}
