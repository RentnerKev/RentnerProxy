import { z } from 'zod'
import { crowdSecApiUrlSchema, crowdSecModeSchema } from '@/features/Admin/CrowdSec/validation.ts'

const encryptedApiKeySchema = z.strictObject({
    ciphertext: z.string().min(1).max(1_024),
    iv: z.string().min(1).max(64),
})

const externalConfigurationSchema = z.strictObject({
    apiUrl: crowdSecApiUrlSchema,
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
