import { describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { QUICK_SEARCH_ACTIONS, QUICK_SEARCH_LIMIT } from '@/config/quick-search.config.ts'
import {
    canRunQuickSearchAction,
    getQuickSearchActions,
} from '@/lib/QuickSearch/quickSearchActions.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import en from '@/lib/Language/Locales/en.json'
import de from '@/lib/Language/Locales/de.json'

function translate(catalog: typeof en | typeof de): Translate {
    return (key) => {
        const value = key
            .split('.')
            .reduce<unknown>((item, part) => (item as Record<string, unknown>)[part], catalog)
        if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`)
        return value
    }
}
const permissions = Object.values(PERMISSIONS)

describe('quick-search actions', () => {
    test.each([
        ['Create proxy', 'createProxyHost'],
        ['add proxys', 'createProxyHost'],
        ['Proxy neu anlegen', 'createProxyHost'],
        ['Zertifikat anfordern', 'requestCertificate'],
        ['upload pem', 'importCertificate'],
        ['trusted ca import', 'importTrustedCa'],
        ['Neue Zugriffsregel', 'createAccessPolicy'],
        ['new DNS connection', 'createDnsConnection'],
        ['create ddns record', 'createDdnsRecord'],
        ['create user', 'createUser'],
        ['Rolle erstellen', 'createRole'],
    ] as const)('finds the intended modal for %s in either interface language', (query, id) => {
        for (const catalog of [en, de])
            expect(
                getQuickSearchActions(permissions, query!, translate(catalog)).map(
                    (result) => result.actionId,
                ),
            ).toContain(id)
    })
    test('offers both issuance and import for certificate creation and bounds generic results', () => {
        expect(
            getQuickSearchActions(permissions, 'create certificate', translate(en)).map(
                (result) => result.actionId,
            ),
        ).toEqual(['requestCertificate', 'importCertificate'])
        expect(getQuickSearchActions(permissions, '', translate(en))).toHaveLength(
            QUICK_SEARCH_LIMIT,
        )
    })
    test('requires every read and write dependency and never exposes create actions to viewers', () => {
        expect(getQuickSearchActions([], '', translate(en))).toEqual([])
        expect(
            getQuickSearchActions(
                [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.CERTIFICATES_VIEW],
                'create',
                translate(en),
            ),
        ).toEqual([])
        for (const action of QUICK_SEARCH_ACTIONS) {
            expect(canRunQuickSearchAction(action.id, action.permissions)).toBe(true)
            for (const missing of action.permissions)
                expect(
                    canRunQuickSearchAction(
                        action.id,
                        action.permissions.filter((permission) => permission !== missing),
                    ),
                ).toBe(false)
        }
    })
})
