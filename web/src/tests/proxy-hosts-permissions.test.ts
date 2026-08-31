import { describe, expect, test } from 'bun:test'

import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

const proxyHostPermissions: string[] = [
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_DELETE,
    PERMISSIONS.PROXY_HOSTS_ENABLE,
    PERMISSIONS.PROXY_HOSTS_DISABLE,
    PERMISSIONS.PROXY_HOSTS_APPLY,
]
const proxyHostPermissionSet = new Set(proxyHostPermissions)

describe('ProxyHost permissions', () => {
    test('registers all seven ProxyHost permissions exactly once', () => {
        expect(proxyHostPermissions).toEqual([
            'proxy_hosts.view',
            'proxy_hosts.create',
            'proxy_hosts.update',
            'proxy_hosts.delete',
            'proxy_hosts.enable',
            'proxy_hosts.disable',
            'proxy_hosts.apply',
        ])
        expect(new Set(proxyHostPermissions).size).toBe(7)
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => proxyHostPermissionSet.has(key)),
        ).toHaveLength(7)
    })

    test('grants all ProxyHost permissions to owner and admin, view only to viewer', () => {
        const permissionsByRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )

        expect(permissionsByRole.get(SYSTEM_ROLES.OWNER)).toEqual(
            expect.arrayContaining(proxyHostPermissions),
        )
        expect(permissionsByRole.get(SYSTEM_ROLES.ADMIN)).toEqual(
            expect.arrayContaining(proxyHostPermissions),
        )
        expect(permissionsByRole.get(SYSTEM_ROLES.VIEWER)).toEqual(
            expect.arrayContaining([PERMISSIONS.PROXY_HOSTS_VIEW]),
        )
        expect(permissionsByRole.get(SYSTEM_ROLES.VIEWER)).not.toEqual(
            expect.arrayContaining(proxyHostPermissions.slice(1)),
        )
    })
})
