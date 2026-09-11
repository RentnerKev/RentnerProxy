import { describe, expect, test } from 'bun:test'

import { PERMISSION_REGISTRY } from '../config/permissions.config'
import { AVAILABLE_LANGUAGES } from '../config/language.config'
import { getAvailablePermissionGroups } from '../features/Admin/RoleManagement/Helpers/permissionCheckboxes'
import { catalogs } from './Helpers/withTestLanguage'

function getCatalogValue(catalog: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => {
        if (!value || typeof value !== 'object' || !(key in value)) {
            return undefined
        }

        return (value as Record<string, unknown>)[key]
    }, catalog)
}

describe('role permission groups', () => {
    test('exposes every registered permission in registry order', () => {
        const groups = getAvailablePermissionGroups(PERMISSION_REGISTRY.map(({ key }) => key))

        expect(groups.map(({ prefix }) => prefix)).toEqual([
            'app.',
            'proxy_hosts.',
            'redirect_hosts.',
            'certificates.',
            'trusted_cas.',
            'users.',
            'roles.',
            'access_policies.',
            'account.',
        ])
        expect(groups.flatMap(({ permissions }) => permissions.map(({ key }) => key))).toEqual(
            PERMISSION_REGISTRY.map(({ key }) => key),
        )
    })

    test('provides a localized label for every group and permission', () => {
        const groups = getAvailablePermissionGroups(PERMISSION_REGISTRY.map(({ key }) => key))
        const labelKeys = [
            ...groups.map(({ label }) => label),
            ...PERMISSION_REGISTRY.map(({ key }) => `permissions.${key}`),
        ]

        for (const language of AVAILABLE_LANGUAGES) {
            const catalog = catalogs[language]

            for (const key of labelKeys) {
                const value = getCatalogValue(catalog, key)
                expect(typeof value, `${language}:${key}`).toBe('string')
                expect(String(value).trim(), `${language}:${key}`).not.toBe('')
                expect(value, `${language}:${key}`).not.toBe(key)
            }
        }
    })

    test('keeps the browser-facing proxy apply label translated', () => {
        const expected = {
            en: 'Apply proxy configuration',
            de: 'Proxy-Konfiguration anwenden',
            es: 'Aplicar la configuración del proxy',
            fr: 'Appliquer la configuration du proxy',
        } as const

        for (const language of AVAILABLE_LANGUAGES) {
            expect(getCatalogValue(catalogs[language], 'permissions.proxy_hosts.apply')).toBe(
                expected[language],
            )
        }
    })
})
