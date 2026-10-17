import { expect, test } from 'bun:test'
import { PERMISSIONS, PERMISSION_REGISTRY, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { SYSTEM_ROLE_REGISTRY } from '@/lib/Permissions/systemRoles.ts'

test('Docker discovery grants management access to owner/admin and keeps sources restricted from viewer', () => {
    const roles = new Map(
        SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
    )
    for (const permission of [
        PERMISSIONS.DOCKER_DISCOVERY_VIEW,
        PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
    ]) {
        expect(PERMISSION_REGISTRY.filter(({ key }) => key === permission)).toHaveLength(1)
        expect(roles.get(SYSTEM_ROLES.OWNER)).toContain(permission)
        expect(roles.get(SYSTEM_ROLES.ADMIN)).toContain(permission)
        expect(roles.get(SYSTEM_ROLES.VIEWER)).not.toContain(permission)
    }
})
