import { describe, expect, test } from 'bun:test'

import {
    PERMISSIONS,
    PERMISSION_REGISTRY,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
} from '../config/permissions.config'
import getApplicationShellViewModel from '../layout/Components/ApplicationShell/Helpers/getApplicationShellViewModel'
import type { Translate } from '../language/useTranslationStore'

describe('CrowdSec permissions', () => {
    test('shows the separate security and configuration navigation only to viewers', () => {
        const user = {
            id: 'viewer',
            displayName: 'Viewer',
            email: 'viewer@example.test',
            profileImageVersion: null,
            permissions: [PERMISSIONS.CROWDSEC_VIEW],
        }
        const translate = ((key: string) => key) as Translate
        const visible = getApplicationShellViewModel(user, translate)
        expect(visible.navigationItems.map((item) => item.to)).toContain('/security')
        expect(visible.navigationItems.map((item) => item.to)).toContain('/crowdsec')
        const hidden = getApplicationShellViewModel({ ...user, permissions: [] }, translate)
        expect(hidden.navigationItems.map((item) => item.to)).not.toContain('/security')
    })
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
