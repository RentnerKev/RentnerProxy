import { describe, expect, test } from 'bun:test'

import { PERMISSION_REGISTRY } from '@/config/permissions.config.ts'
import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import {
    filterPermissionGroups,
    getAvailablePermissionGroups,
} from '@/lib/Admin/RoleManagement/permissionCheckboxes.ts'
import { createTranslationStore } from '@/shared/Language/Hooks/useTranslationStore.ts'
import { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'

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
            'dns_connections.',
            'ddns.',
            'notifications.',
            'docker_discovery.',
            'trusted_cas.',
            'users.',
            'roles.',
            'access_policies.',
            'proxy-access-logs:',
            'crowdsec.',
            'default_site.',
            'audit-logs:',
            'system.',
            'account.',
        ])
        expect(groups.flatMap(({ permissions }) => permissions.map(({ key }) => key))).toEqual(
            PERMISSION_REGISTRY.map(({ key }) => key),
        )
    })

    test('finds localized permission names regardless of case and surrounding whitespace', () => {
        const groups = getAvailablePermissionGroups(PERMISSION_REGISTRY.map(({ key }) => key))
        const t = createTranslationStore({
            language: 'de',
            resources: { de: { translation: catalogs.de } },
        }).getTranslate('de')

        const filtered = filterPermissionGroups(groups, '  PROXY-KONFIGURATION ANWENDEN  ', t)

        expect(filtered.map(({ prefix }) => prefix)).toEqual(['proxy_hosts.'])
        expect(filtered.flatMap(({ permissions }) => permissions.map(({ key }) => key))).toEqual([
            'proxy_hosts.apply',
        ])
    })

    test('finds technical permission keys with dot and colon separators', () => {
        const groups = getAvailablePermissionGroups(PERMISSION_REGISTRY.map(({ key }) => key))
        const t = createTranslationStore({
            language: 'en',
            resources: { en: { translation: catalogs.en } },
        }).getTranslate('en')

        for (const permissionKey of ['proxy_hosts.apply', 'proxy-access-logs:view'] as const) {
            const filtered = filterPermissionGroups(groups, permissionKey.toUpperCase(), t)
            expect(
                filtered.flatMap(({ permissions }) => permissions.map(({ key }) => key)),
            ).toEqual([permissionKey])
        }
    })

    test('matches localized groups while retaining only assignable permissions in registry order', () => {
        const groups = getAvailablePermissionGroups([
            'proxy_hosts.apply',
            'app.access',
            'proxy_hosts.view',
        ])
        const original = structuredClone(groups)
        const t = createTranslationStore({
            language: 'de',
            resources: { de: { translation: catalogs.de } },
        }).getTranslate('de')

        const filtered = filterPermissionGroups(groups, 'proxy-hosts', t)

        expect(filtered.flatMap(({ permissions }) => permissions.map(({ key }) => key))).toEqual([
            'proxy_hosts.view',
            'proxy_hosts.apply',
        ])
        expect(groups).toEqual(original)
        expect(filterPermissionGroups(groups, '   ', t)).toEqual(original)
        expect(filterPermissionGroups(groups, 'no-matching-permission', t)).toEqual([])
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
        const expected: Partial<Record<AppLanguage, string>> = {
            en: 'Apply proxy configuration',
            de: 'Proxy-Konfiguration anwenden',
            es: 'Aplicar la configuración del proxy',
            fr: 'Appliquer la configuration du proxy',
        }

        for (const language of AVAILABLE_LANGUAGES) {
            const label = getCatalogValue(catalogs[language], 'permissions.proxy_hosts.apply')
            if (expected[language]) {
                expect(label).toBe(expected[language])
            } else {
                expect(label).not.toBe(expected.en)
            }
        }
    })
})
