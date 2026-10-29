import { z } from 'zod'
import { CROWDSEC_API_URL_MAX_LENGTH } from '@/config/crowdsec.config.ts'
import { crowdSecModeSchema } from '@/features/Admin/CrowdSec/validation.ts'

const storedApiUrlSchema = z
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

const encryptedApiKeySchema = z.strictObject({
    ciphertext: z.string().min(1).max(1_024),
    iv: z.string().min(1).max(64),
})

const externalConfigurationSchema = z.strictObject({
    apiUrl: storedApiUrlSchema,
    apiKey: encryptedApiKeySchema,
})

export const storedCrowdSecConfigurationSchema = z
    .strictObject({
        version: z.literal(1),
        mode: crowdSecModeSchema,
        communityEnabled: z.boolean().optional(),
        external: externalConfigurationSchema.optional(),
    })
    .superRefine((value, context) => {
        if (value.mode === 'external' && value.external === undefined) {
            context.addIssue({ code: 'custom', path: ['external'], message: 'required' })
        }
    })
