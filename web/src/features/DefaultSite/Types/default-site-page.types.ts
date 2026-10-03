import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'

export interface DefaultSitePageProps {
    readonly permissions: readonly PermissionKey[]
}
