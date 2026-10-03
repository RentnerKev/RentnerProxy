import { z } from 'zod'

import { USER_APPEARANCE_SETTINGS_KEY_PREFIX } from '@/config/appearance.config.ts'

const accentColorSchema = z
    .string()
    .regex(/^#[\da-fA-F]{6}$/u, 'invalid_accent_color')
    .transform((value) => value.toLowerCase())

export const userAccentColorUpdateSchema = z.strictObject({
    expectedUserId: z.uuid(),
    accentColor: accentColorSchema.nullable(),
})

export const storedUserAppearanceSchema = z.strictObject({
    version: z.literal(1),
    accentColor: accentColorSchema,
})

export function userAppearanceSettingsKey(userId: string): string {
    return USER_APPEARANCE_SETTINGS_KEY_PREFIX + userId
}

export function parseStoredUserAppearance(input: unknown): string | null {
    let value = input
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    const parsed = storedUserAppearanceSchema.safeParse(value)
    return parsed.success ? parsed.data.accentColor : null
}
