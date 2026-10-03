import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'

export function getDefaultSitePageViewModel(permissions: readonly PermissionKey[]) {
    return {
        canView: permissions.includes(PERMISSIONS.DEFAULT_SITE_VIEW),
        canUpdate:
            permissions.includes(PERMISSIONS.DEFAULT_SITE_UPDATE) &&
            permissions.includes(PERMISSIONS.PROXY_HOSTS_APPLY),
    }
}
