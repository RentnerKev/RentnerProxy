import { describe, expect, test } from 'bun:test'
import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

const proxyHostPermissions: readonly string[] = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_DELETE,
    PERMISSIONS.PROXY_HOSTS_ENABLE,
    PERMISSIONS.PROXY_HOSTS_DISABLE,
    PERMISSIONS.PROXY_HOSTS_APPLY,
]

describe('ProxyHost permissions', () => {
    test('registers the seven Caddy proxy permissions exactly once', () => {
        expect(new Set(proxyHostPermissions).size).toBe(7)
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => proxyHostPermissions.includes(key)),
        ).toHaveLength(7)
    })
    test('grants mutations to owner/admin and view only to viewer', () => {
        const byRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )
        expect(byRole.get(SYSTEM_ROLES.OWNER) ?? []).toEqual(
            expect.arrayContaining(proxyHostPermissions),
        )
        expect(byRole.get(SYSTEM_ROLES.ADMIN) ?? []).toEqual(
            expect.arrayContaining(proxyHostPermissions),
        )
        expect(byRole.get(SYSTEM_ROLES.VIEWER) ?? []).toEqual(
            expect.arrayContaining([PERMISSIONS.PROXY_HOSTS_VIEW]),
        )
        expect(byRole.get(SYSTEM_ROLES.VIEWER) ?? []).not.toEqual(
            expect.arrayContaining(proxyHostPermissions.slice(1)),
        )
    })
})
