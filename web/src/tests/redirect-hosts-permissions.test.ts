import { describe, expect, test } from 'bun:test'
import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

const redirectPermissions: readonly string[] = [
    PERMISSIONS.REDIRECT_HOSTS_VIEW,
    PERMISSIONS.REDIRECT_HOSTS_CREATE,
    PERMISSIONS.REDIRECT_HOSTS_UPDATE,
    PERMISSIONS.REDIRECT_HOSTS_DELETE,
    PERMISSIONS.REDIRECT_HOSTS_ENABLE,
    PERMISSIONS.REDIRECT_HOSTS_DISABLE,
    PERMISSIONS.REDIRECT_HOSTS_APPLY,
]

describe('Redirect Host permissions', () => {
    test('registers the seven Redirect Host permissions exactly once', () => {
        expect(new Set(redirectPermissions).size).toBe(7)
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => redirectPermissions.includes(key)),
        ).toHaveLength(7)
    })

    test('grants all Redirect Host permissions to owner/admin and view only to viewer', () => {
        const byRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )
        expect(byRole.get(SYSTEM_ROLES.OWNER)).toEqual(expect.arrayContaining(redirectPermissions))
        expect(byRole.get(SYSTEM_ROLES.ADMIN)).toEqual(expect.arrayContaining(redirectPermissions))
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).toEqual(
            expect.arrayContaining([PERMISSIONS.REDIRECT_HOSTS_VIEW]),
        )
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).not.toEqual(
            expect.arrayContaining(redirectPermissions.slice(1)),
        )
    })
})
