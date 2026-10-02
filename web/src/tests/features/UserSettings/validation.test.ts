import { describe, expect, test } from 'bun:test'

import { updateLanguageInputSchema } from '@/features/UserSettings/validation.ts'
import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'

describe('language validation', () => {
    test('accepts each supported application language', () => {
        for (const language of AVAILABLE_LANGUAGES) {
            expect(updateLanguageInputSchema.parse({ language })).toEqual({ language })
        }
    })

    test('rejects unsupported and differently cased languages', () => {
        expect(updateLanguageInputSchema.safeParse({ language: 'ja' }).success).toBeFalse()
        expect(updateLanguageInputSchema.safeParse({ language: 'DE' }).success).toBeFalse()
        expect(updateLanguageInputSchema.safeParse({ language: '' }).success).toBeFalse()
    })
})
