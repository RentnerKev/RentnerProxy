import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'

export interface DefaultSitePageProps {
    readonly permissions: readonly PermissionKey[]
}
