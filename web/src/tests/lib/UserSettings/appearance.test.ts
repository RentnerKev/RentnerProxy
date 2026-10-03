import { describe, expect, test } from 'bun:test'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import {
    parseStoredUserAppearance,
    storedUserAppearanceSchema,
    userAccentColorUpdateSchema,
} from '@/lib/UserSettings/appearance.ts'

const expectedUserId = '6f355778-511f-467b-ad8f-8c4a29b84510'

describe('user appearance validation', () => {
    test('normalizes six-digit hex colors and accepts null to reset', () => {
        expect(
            userAccentColorUpdateSchema.parse({ expectedUserId, accentColor: '#Ab12Ef' }),
        ).toEqual({
            expectedUserId,
            accentColor: '#ab12ef',
        })
        expect(userAccentColorUpdateSchema.parse({ expectedUserId, accentColor: null })).toEqual({
            expectedUserId,
            accentColor: null,
        })
    })

    test('rejects malformed colors and unexpected settings', () => {
        for (const accentColor of ['green', '#12ab', '#12345678', ' #123456', '#gg0000']) {
            expect(
                userAccentColorUpdateSchema.safeParse({ expectedUserId, accentColor }).success,
            ).toBeFalse()
        }
        expect(
            userAccentColorUpdateSchema.safeParse({
                expectedUserId,
                accentColor: '#123456',
                mode: 'dark',
            }).success,
        ).toBeFalse()
    })

    test('requires persisted values to match the strict versioned schema', () => {
        expect(parseStoredUserAppearance({ version: 1, accentColor: '#AABBCC' })).toBe('#aabbcc')
        expect(parseStoredUserAppearance({ version: 2, accentColor: '#aabbcc' })).toBeNull()
        expect(
            parseStoredUserAppearance({ version: 1, accentColor: '#aabbcc', mode: 'dark' }),
        ).toBeNull()
        expect(DEFAULT_ACCENT_COLOR).toBe('#30ee61')
        expect(
            storedUserAppearanceSchema.safeParse({ version: 1, accentColor: '#abcdef' }).success,
        ).toBeTrue()
    })

    test('requires an expected account and rejects attempts to supply a different target', () => {
        expect(
            userAccentColorUpdateSchema.safeParse({ accentColor: '#abcdef' }).success,
        ).toBeFalse()
        expect(
            userAccentColorUpdateSchema.safeParse({ expectedUserId: 'invalid', accentColor: null })
                .success,
        ).toBeFalse()
        expect(
            userAccentColorUpdateSchema.safeParse({
                expectedUserId,
                accentColor: '#abcdef',
                userId: 'another-user',
            }).success,
        ).toBeFalse()
    })
})
