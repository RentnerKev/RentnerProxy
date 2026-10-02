import { z } from 'zod'
export const accentColorSchema = z
    .string()
    .regex(/^#[\da-fA-F]{6}$/u, 'invalid_accent_color')
    .transform((value) => value.toLowerCase())

export const systemAccentColorUpdateSchema = z.strictObject({
    accentColor: accentColorSchema.nullable(),
})

export const storedSystemAppearanceSchema = z.strictObject({
    version: z.literal(1),
    accentColor: accentColorSchema,
})

export function parseStoredSystemAppearance(input: unknown): string | null {
    let value = input
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    const parsed = storedSystemAppearanceSchema.safeParse(value)
    return parsed.success ? parsed.data.accentColor : null
}
