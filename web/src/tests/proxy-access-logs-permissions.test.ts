import { describe, expect, test } from 'bun:test'

import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

describe('proxy access-log permissions', () => {
    test('registers one view permission and grants it to owner/admin only', () => {
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => key === PERMISSIONS.PROXY_ACCESS_LOGS_VIEW),
        ).toHaveLength(1)

        const byRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )
        expect(byRole.get(SYSTEM_ROLES.OWNER)).toContain(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
        expect(byRole.get(SYSTEM_ROLES.ADMIN)).toContain(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).not.toContain(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
    })
})
