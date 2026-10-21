import { z } from 'zod'
import { DEFAULT_HOST_TAG_COLOR } from '@/config/host-tags.config.ts'
import { accentContrastRatio } from '@/lib/Theme/accentPalette.ts'

export const hostTagColorSchema = z
    .string()
    .regex(/^#[\da-fA-F]{6}$/u, 'admin.hostTags.errors.invalidColor')
    .transform((value) => value.toLowerCase())

export function hostTagBadgeStyle(value: string | undefined) {
    const parsed = hostTagColorSchema.safeParse(value)
    const backgroundColor = parsed.success ? parsed.data : DEFAULT_HOST_TAG_COLOR
    const color =
        accentContrastRatio(backgroundColor, '#000000') >=
        accentContrastRatio(backgroundColor, '#ffffff')
            ? '#000000'
            : '#ffffff'
    return { backgroundColor, color }
}
