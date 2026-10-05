import { describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    getQuickSearchNavigation,
    matchesQuickSearch,
} from '@/lib/QuickSearch/quickSearchNavigation.ts'
import en from '@/lib/Language/Locales/en.json'

const translate = (key: string) =>
    key
        .split('.')
        .reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], en) as string

describe('quick search navigation', () => {
    test('matches localized names without casing, accent or whitespace differences', () => {
        expect(matchesQuickSearch(' ZERTIFIKAT ', 'Zertifikate')).toBe(true)
        expect(matchesQuickSearch('reglès accès', 'Règles d’accès')).toBe(true)
        expect(matchesQuickSearch('logs proxy', 'Proxy access logs')).toBe(true)
        expect(matchesQuickSearch('secret', 'Proxy hosts')).toBe(false)
    })

    test('exposes only current authorized pages and bounds navigation suggestions', () => {
        expect(getQuickSearchNavigation([], '', translate).map((item) => item.to)).toEqual(['/'])
        expect(getQuickSearchNavigation([], 'certificate', translate)).toEqual([])
        expect(
            getQuickSearchNavigation([PERMISSIONS.PROXY_HOSTS_VIEW], 'proxy', translate).map(
                (item) => item.to,
            ),
        ).toEqual(['/proxy-hosts'])
        expect(getQuickSearchNavigation(Object.values(PERMISSIONS), '', translate)).toHaveLength(8)
    })

    test('routes authorized setting matches to the existing account sections', () => {
        const [result] = getQuickSearchNavigation([PERMISSIONS.ACCOUNT_VIEW], 'language', translate)
        expect(result).toMatchObject({ to: '/account', category: 'settings', section: 'language' })
        expect(getQuickSearchNavigation([], 'language', translate)).toEqual([])
    })
})
