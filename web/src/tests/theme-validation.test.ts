import { describe, expect, test } from 'bun:test'

import { updateThemeModeInputSchema } from '../features/UserSettings/validation'

describe('theme validation', () => {
    test('accepts each supported theme mode', () => {
        expect(updateThemeModeInputSchema.parse({ themeMode: 'light' })).toEqual({
            themeMode: 'light',
        })
        expect(updateThemeModeInputSchema.parse({ themeMode: 'dark' })).toEqual({
            themeMode: 'dark',
        })
    })

    test('rejects unknown and differently cased theme modes', () => {
        expect(updateThemeModeInputSchema.safeParse({ themeMode: 'system' }).success).toBeFalse()
        expect(updateThemeModeInputSchema.safeParse({ themeMode: 'DARK' }).success).toBeFalse()
    })
})
