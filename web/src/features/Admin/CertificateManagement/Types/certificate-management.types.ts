import type { PermissionKey } from '../../../../config/permissions.config'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import type useCertificateManagementLogic from '../Hooks/useCertificateManagementLogic'

export interface CertificateManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface CertificateManagementPageViewProps {
    readonly logic: ReturnType<typeof useCertificateManagementLogic>
}

export interface CertificateTableProps {
    readonly certificates: ReadonlyArray<CertificateSummary>
    readonly loading: boolean
    readonly canCreate: boolean
    readonly canIssue: boolean
    readonly canRenew: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onCreate: () => void
    readonly onRequest: () => void
    readonly onDetails: (certificate: CertificateSummary) => void
    readonly onRenew: (certificate: CertificateSummary) => void
    readonly onReplace: (certificate: CertificateSummary) => void
    readonly onDelete: (certificate: CertificateSummary) => void
}

export interface CertificateTableActionsProps {
    readonly certificate: CertificateSummary
    readonly canRenew: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onDetails: (certificate: CertificateSummary) => void
    readonly onRenew: (certificate: CertificateSummary) => void
    readonly onReplace: (certificate: CertificateSummary) => void
    readonly onDelete: (certificate: CertificateSummary) => void
}

export interface CertificateDetailsModalProps {
    readonly certificate: CertificateSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

export interface CertificateImportModalProps {
    readonly certificate?: CertificateSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void | Promise<void>
}

export interface CertificateRequestModalProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void
    readonly initialDomains?: ReadonlyArray<string>
    readonly initialName?: string
}
