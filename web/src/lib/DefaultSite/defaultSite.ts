import { z } from 'zod'

import { MAX_DEFAULT_SITE_HTML_BYTES } from '@/config/default-site.config.ts'
import { normalizeRedirectDestination } from '@/features/Admin/RedirectHostManagement/validation.ts'

const redirectUrlSchema = z
    .string()
    .max(2_048, 'defaultSite.errors.invalidUrl')
    .transform((value, context) => {
        const normalized = normalizeRedirectDestination(value, false)
        if (normalized === null) {
            context.addIssue({ code: 'custom', message: 'defaultSite.errors.invalidUrl' })
            return z.NEVER
        }
        return normalized
    })

const customHtmlSchema = z
    .string()
    .max(MAX_DEFAULT_SITE_HTML_BYTES, 'defaultSite.errors.invalidHtml')
    .refine(
        (value) =>
            value.trim().length > 0 &&
            !value.includes('\0') &&
            value.isWellFormed() &&
            new TextEncoder().encode(value).byteLength <= MAX_DEFAULT_SITE_HTML_BYTES,
        'defaultSite.errors.invalidHtml',
    )

export const defaultSiteSettingsSchema = z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('not-found') }),
    z.strictObject({ mode: z.literal('welcome') }),
    z.strictObject({ mode: z.literal('close') }),
    z.strictObject({ mode: z.literal('redirect'), url: redirectUrlSchema }),
    z.strictObject({ mode: z.literal('custom-html'), html: customHtmlSchema }),
])

export const defaultSiteSaveSchema = z.strictObject({
    baseRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings: defaultSiteSettingsSchema,
})
