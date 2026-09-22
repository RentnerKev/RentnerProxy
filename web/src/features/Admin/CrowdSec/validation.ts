import { z } from 'zod'

import {
    CROWDSEC_API_KEY_MAX_LENGTH,
    CROWDSEC_API_KEY_MIN_LENGTH,
    CROWDSEC_API_URL_MAX_LENGTH,
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
        apiUrl: crowdSecApiUrlSchema.optional(),
        apiKey: crowdSecApiKeySchema.optional(),
    })
    .superRefine((value, context) => {
        if (value.mode === 'external') {
            if (value.apiUrl === undefined) {
                context.addIssue({ code: 'custom', path: ['apiUrl'], message: 'required' })
            }
            return
        }
        if (value.apiUrl !== undefined || value.apiKey !== undefined) {
            context.addIssue({ code: 'custom', message: 'unexpected_external_configuration' })
        }
    })

export const testCrowdSecConnectionSchema = z.strictObject({
    apiUrl: crowdSecApiUrlSchema,
    apiKey: crowdSecApiKeySchema.optional(),
})

export type UpdateCrowdSecConfigurationInput = z.infer<typeof updateCrowdSecConfigurationSchema>
export type TestCrowdSecConnectionInput = z.infer<typeof testCrowdSecConnectionSchema>
