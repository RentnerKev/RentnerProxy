import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'

export interface RuntimeSupportDownloadProps {
    readonly permissions: readonly PermissionKey[]
}

export interface RuntimeSupportDownloadLogic {
    readonly state: {
        readonly canExport: boolean
        readonly isExporting: boolean
        readonly feedback: 'complete' | 'partial' | 'failed' | null
    }
    readonly handler: { readonly download: () => void }
}
