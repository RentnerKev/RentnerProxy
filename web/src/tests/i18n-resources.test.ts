import { describe, expect, spyOn, test } from 'bun:test'

import { AVAILABLE_LANGUAGES, LANGUAGE_RESOURCE_LOADERS } from '../config/language.config'
import { createTranslationStore, loadLanguageBootstrap } from '../language/useTranslationStore'
import { catalogs } from './Helpers/withTestLanguage'

function flatten(value: unknown, prefix = ''): Record<string, string> {
    if (typeof value === 'string') return { [prefix]: value }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid catalog value at ${prefix}`)
    }
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]) =>
            Object.entries(flatten(entry, prefix ? `${prefix}.${key}` : key)),
        ),
    )
}

function placeholders(value: string): string[] {
    return Array.from(value.matchAll(/\{\{\s*([^},]+)(?:,[^}]+)?\s*\}\}/gu), (match) =>
        match[1]!.trim(),
    ).toSorted()
}

describe('authenticated language resources', () => {
    test('has four complete catalogs with matching keys and interpolation variables', () => {
        const english = flatten(catalogs.en)
        expect(Object.keys(english).length).toBeGreaterThan(250)

        for (const language of AVAILABLE_LANGUAGES) {
            const entries = flatten(catalogs[language])
            expect(Object.keys(entries).toSorted()).toEqual(Object.keys(english).toSorted())
            for (const [key, value] of Object.entries(entries)) {
                expect(value.trim(), `${language}:${key}`).not.toBe('')
                expect(value, `${language}:${key}`).not.toBe(key)
                expect(placeholders(value), `${language}:${key}`).toEqual(
                    placeholders(english[key]!),
                )
            }
        }
    })

    test('loads only the selected language and the English fallback', async () => {
        const bootstraps = await Promise.all(AVAILABLE_LANGUAGES.map(loadLanguageBootstrap))
        for (const [index, language] of AVAILABLE_LANGUAGES.entries()) {
            const bootstrap = bootstraps[index]!
            expect(bootstrap.language).toBe(language)
            expect(Object.keys(bootstrap.resources).toSorted()).toEqual(
                language === 'en' ? ['en'] : [language, 'en'].toSorted(),
            )
            expect(JSON.parse(JSON.stringify(bootstrap))).toEqual(bootstrap)
        }
    })

    test('uses English for unsupported preferences instead of importing arbitrary paths', async () => {
        const bootstraps = await Promise.all(
            [undefined, null, 'DE', 'it', '../secret', 'constructor'].map(loadLanguageBootstrap),
        )
        for (const bootstrap of bootstraps) {
            expect(bootstrap.language).toBe('en')
            expect(Object.keys(bootstrap.resources)).toEqual(['en'])
        }
    })

    test('keeps concurrent requests and user stores independent', async () => {
        const [german, french] = await Promise.all([
            loadLanguageBootstrap('de'),
            loadLanguageBootstrap('fr'),
        ])
        const firstUser = createTranslationStore(german)
        const secondUser = createTranslationStore(french)
        const events: string[] = []
        const unsubscribe = firstUser.subscribe(() => events.push(firstUser.getSnapshot()))

        expect(firstUser.getTranslate('de')('shell.account')).toBe('Konto')
        expect(secondUser.getTranslate('fr')('shell.account')).toBe('Compte')
        await firstUser.setLanguage('es')
        expect(firstUser.getSnapshot().startsWith('es:')).toBe(true)
        expect(secondUser.getSnapshot().startsWith('fr:')).toBe(true)
        expect(firstUser.getTranslate('es')('shell.account')).toBe('Cuenta')
        expect(secondUser.getTranslate('fr')('shell.account')).toBe('Compte')
        expect(events.length).toBeGreaterThan(0)
        expect(german.language).toBe('de')
        expect(Object.keys(german.resources).toSorted()).toEqual(['de', 'en'])
        unsubscribe()
    })

    test('clones bootstrap resources instead of sharing mutable i18next state', async () => {
        const first = await loadLanguageBootstrap('de')
        const second = await loadLanguageBootstrap('de')
        expect(first.resources).not.toBe(second.resources)
        expect(first.resources.de).not.toBe(second.resources.de)
        const store = createTranslationStore(first)
        first.resources.de!.translation = { shell: { account: 'mutated fixture' } }
        expect(store.getTranslate('de')('shell.account')).toBe('Konto')
        expect(createTranslationStore(second).getTranslate('de')('shell.account')).toBe('Konto')
    })

    test('falls back to English per key without affecting another user', () => {
        const store = createTranslationStore({
            language: 'fr',
            resources: {
                en: { translation: { onlyEnglish: 'English fallback' } },
                fr: { translation: { translated: 'Français' } },
            },
        })
        expect(store.getTranslate('fr')('translated')).toBe('Français')
        expect(store.getTranslate('fr')('onlyEnglish')).toBe('English fallback')
    })

    test('leaves the active language unchanged when a selected catalog fails to load', async () => {
        const store = createTranslationStore(await loadLanguageBootstrap('en'))
        const loader = spyOn(LANGUAGE_RESOURCE_LOADERS, 'de').mockRejectedValue(
            new Error('Synthetic resource failure'),
        )
        try {
            await expect(store.setLanguage('de')).rejects.toThrow('language.loadFailed')
            expect(store.getSnapshot()).toBe('en:0')
            expect(store.getTranslate('en')('shell.account')).toBe('Account')
        } finally {
            loader.mockRestore()
        }
    })

    test('interpolates zero rather than hard-coding one in French plural forms', async () => {
        const t = createTranslationStore(await loadLanguageBootstrap('fr')).getTranslate('fr')
        for (const key of [
            'admin.users.table.count',
            'admin.roles.table.count',
            'admin.roles.actions.assignedTo',
            'admin.roles.cells.permissionsAssigned',
        ]) {
            expect(t(key, { count: 0 }), key).toContain('0')
            expect(t(key, { count: 2 }), key).toContain('2')
        }
        for (const key of ['created', 'updated', 'deleted']) {
            const message = `admin.roles.messages.${key}`
            expect(t(message)).not.toBe(message)
        }
    })
})
