import { expect, test } from 'bun:test'
import { PERMISSIONS, PERMISSION_REGISTRY, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { SYSTEM_ROLE_REGISTRY } from '@/lib/Permissions/systemRoles.ts'

test('notification administration belongs to owner/admin and operational status remains restricted from viewer', () => {
    const roles = new Map(
        SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
    )
    for (const permission of [PERMISSIONS.NOTIFICATIONS_VIEW, PERMISSIONS.NOTIFICATIONS_MANAGE]) {
        expect(PERMISSION_REGISTRY.filter(({ key }) => key === permission)).toHaveLength(1)
        expect(roles.get(SYSTEM_ROLES.OWNER)).toContain(permission)
        expect(roles.get(SYSTEM_ROLES.ADMIN)).toContain(permission)
        expect(roles.get(SYSTEM_ROLES.VIEWER)).not.toContain(permission)
    }
})
