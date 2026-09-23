import { describe, expect, test } from 'bun:test'

import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'

describe('CrowdSec permissions', () => {
    test('registers view and update permissions exactly once', () => {
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => key === PERMISSIONS.CROWDSEC_VIEW),
        ).toHaveLength(1)
        expect(
            PERMISSION_REGISTRY.filter(({ key }) => key === PERMISSIONS.CROWDSEC_UPDATE),
        ).toHaveLength(1)
    })

    test('allows read-only visibility without granting configuration changes', () => {
        const byRole = new Map(
            SYSTEM_ROLE_REGISTRY.map(({ key, permissionKeys }) => [key, permissionKeys]),
        )
        for (const role of [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN]) {
            expect(byRole.get(role)).toContain(PERMISSIONS.CROWDSEC_VIEW)
            expect(byRole.get(role)).toContain(PERMISSIONS.CROWDSEC_UPDATE)
        }
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).toContain(PERMISSIONS.CROWDSEC_VIEW)
        expect(byRole.get(SYSTEM_ROLES.VIEWER)).not.toContain(PERMISSIONS.CROWDSEC_UPDATE)
    })
})
