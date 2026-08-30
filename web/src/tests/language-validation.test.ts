import { describe, expect, test } from 'bun:test'

import { updateLanguageInputSchema } from '../features/UserSettings/validation'

describe('language validation', () => {
    test('accepts each supported application language', () => {
        for (const language of ['en', 'de', 'es', 'fr'] as const) {
            expect(updateLanguageInputSchema.parse({ language })).toEqual({ language })
        }
    })

    test('rejects unsupported and differently cased languages', () => {
        expect(updateLanguageInputSchema.safeParse({ language: 'it' }).success).toBeFalse()
        expect(updateLanguageInputSchema.safeParse({ language: 'DE' }).success).toBeFalse()
        expect(updateLanguageInputSchema.safeParse({ language: '' }).success).toBeFalse()
    })
})
