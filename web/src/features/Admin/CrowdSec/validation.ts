import { z } from 'zod'

import {
    CROWDSEC_API_KEY_MAX_LENGTH,
    CROWDSEC_API_KEY_MIN_LENGTH,
    CROWDSEC_API_URL_MAX_LENGTH,
    CROWDSEC_ENROLLMENT_KEY_MAX_LENGTH,
    CROWDSEC_MODES,
} from '../../../config/crowdsec.config'

export const crowdSecModeSchema = z.enum(CROWDSEC_MODES)

export const crowdSecApiUrlSchema = z
    .string()
    .min(1)
    .max(CROWDSEC_API_URL_MAX_LENGTH)
    .refine((value) => value === value.trim())
    .refine((value) => {
        try {
            const url = new URL(value)
            return (
                (url.protocol === 'http:' || url.protocol === 'https:') &&
                url.hostname.length > 0 &&
                url.username.length === 0 &&
                url.password.length === 0 &&
                url.search.length === 0 &&
                url.hash.length === 0
            )
        } catch {
            return false
        }
    })

export const crowdSecApiKeySchema = z
    .string()
    .min(CROWDSEC_API_KEY_MIN_LENGTH)
    .max(CROWDSEC_API_KEY_MAX_LENGTH)
    .refine((value) => /^[\x21-\x7e]+$/u.test(value))

export const updateCrowdSecConfigurationSchema = z
    .strictObject({
        mode: crowdSecModeSchema,
        communityEnabled: z.boolean().optional(),
        apiUrl: crowdSecApiUrlSchema.optional(),
        apiKey: crowdSecApiKeySchema.optional(),
    })
    .superRefine((value, context) => {
        if (value.mode === 'external') {
            if (value.communityEnabled !== undefined) {
                context.addIssue({
                    code: 'custom',
                    path: ['communityEnabled'],
                    message: 'unexpected_managed_configuration',
                })
            }
            if (value.apiUrl === undefined) {
                context.addIssue({ code: 'custom', path: ['apiUrl'], message: 'required' })
            }
            return
        }
        if (value.apiUrl !== undefined || value.apiKey !== undefined) {
            context.addIssue({ code: 'custom', message: 'unexpected_external_configuration' })
        }
        if (value.mode !== 'managed' && value.communityEnabled !== undefined) {
            context.addIssue({
                code: 'custom',
                path: ['communityEnabled'],
                message: 'unexpected_managed_configuration',
            })
        }
    })

export const crowdSecConsoleEnrollmentSchema = z.strictObject({
    enrollmentKey: z
        .string()
        .min(16)
        .max(CROWDSEC_ENROLLMENT_KEY_MAX_LENGTH)
        .regex(/^[A-Za-z0-9_-]+$/u),
})

export const testCrowdSecConnectionSchema = z.strictObject({
    apiUrl: crowdSecApiUrlSchema,
    apiKey: crowdSecApiKeySchema.optional(),
})

export const crowdSecDashboardQuerySchema = z.strictObject({
    offset: z.number().int().min(0).max(1_000_000),
    limit: z.number().int().min(1).max(100),
    search: z
        .string()
        .max(200)
        .refine((value) => !hasControlCharacters(value)),
    origin: z
        .string()
        .max(80)
        .refine((value) => !hasControlCharacters(value)),
    scope: z.enum(['', 'Ip', 'Range']),
})

function hasControlCharacters(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
    })
}

export type UpdateCrowdSecConfigurationInput = z.infer<typeof updateCrowdSecConfigurationSchema>
export type TestCrowdSecConnectionInput = z.infer<typeof testCrowdSecConnectionSchema>
