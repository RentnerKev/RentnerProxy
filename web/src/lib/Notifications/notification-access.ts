import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { NotificationCategory } from './Types/notifications.types.ts'

export function getAllowedNotificationCategories(
    permissions: readonly PermissionKey[],
): NotificationCategory[] {
    const categories: NotificationCategory[] = []
    if (permissions.includes(PERMISSIONS.CERTIFICATES_VIEW)) categories.push('certificate_renewal')
    if (permissions.includes(PERMISSIONS.DDNS_VIEW)) categories.push('ddns')
    if (
        permissions.includes(PERMISSIONS.PROXY_HOSTS_VIEW) ||
        permissions.includes(PERMISSIONS.REDIRECT_HOSTS_VIEW) ||
        permissions.includes(PERMISSIONS.ACCESS_POLICIES_VIEW)
    )
        categories.push('proxy_configuration')
    return categories
}

export function canUsePrivateNotificationDestinations(
    permissions: readonly PermissionKey[],
): boolean {
    return permissions.includes(PERMISSIONS.NOTIFICATIONS_MANAGE)
}
