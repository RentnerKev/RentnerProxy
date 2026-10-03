import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { CertificateJobSummary } from '@/lib/CertificateJobs/Types/certificate-jobs.types.ts'

export interface CertificateManagementPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface CertificateWorkspaceLogicResult {
    readonly state: {
        readonly active: 'server' | 'trusted'
        readonly canViewServers: boolean
        readonly canViewTrustedCas: boolean
        readonly tabs: readonly {
            readonly value: 'server' | 'trusted'
            readonly allowed: boolean
            readonly label: string
        }[]
    }
    readonly handler: { readonly handleSelect: (value: 'server' | 'trusted') => void }
}

export interface CertificateRequestInputs {
    readonly onSuccess: () => void | Promise<void>
    readonly initialDomains?: ReadonlyArray<string> | undefined
    readonly initialName?: string | undefined
    readonly proxyHostId?: string | undefined
    readonly expectedUpdatedAt?: string | undefined
    readonly readOnlyDomains?: boolean | undefined
    readonly certificateJob?: CertificateJobSummary | null | undefined
}

export interface CertificateManagementLogicResult {
    readonly state: {
        readonly certificates: readonly import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary[]
        readonly canCreate: boolean
        readonly canDelete: boolean
        readonly canIssue: boolean
        readonly canRenew: boolean
        readonly canUpdate: boolean
        readonly importOpen: boolean
        readonly isDeleting: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly isMutating: boolean
        readonly isRenewing: boolean
        readonly requestOpen: boolean
        readonly deleteTarget:
            | import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary
            | null
        readonly detailsTarget:
            | import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary
            | null
        readonly replaceTarget:
            | import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary
            | null
        readonly renewTarget:
            | import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary
            | null
        readonly requestDefaults: { readonly domains?: string[]; readonly name?: string }
    }
    readonly handler: {
        readonly confirmDelete: () => Promise<void>
        readonly confirmRenew: () => Promise<void>
        readonly handleFormSuccess: () => Promise<void>
        readonly openDelete: (
            certificate: import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary,
        ) => void
        readonly openDetails: (
            certificate: import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary,
        ) => void
        readonly openReplace: (
            certificate: import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary,
        ) => void
        readonly openRenew: (
            certificate: import('@/lib/Admin/CertificateManagement/Types/certificates.types.ts').CertificateSummary,
        ) => void
        readonly openRequest: (
            proxyHost?: import('@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts').ProxyHostSummary,
        ) => void
        readonly openImport: () => void
        readonly retry: () => void
        readonly setDeleteDialogOpen: (open: boolean) => void
        readonly setDetailsDialogOpen: (open: boolean) => void
        readonly setImportDialogOpen: (open: boolean) => void
        readonly setReplaceDialogOpen: (open: boolean) => void
        readonly setRequestDialogOpen: (open: boolean) => void
        readonly setRenewDialogOpen: (open: boolean) => void
    }
}
