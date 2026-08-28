import { z } from 'zod'

import { displayNameSchema, emailSchema } from '../../Auth/Shared/validation'

export const roleKeysSchema = z
    .array(z.string().trim().min(1).max(100))
    .min(1, 'Select at least one role.')
    .max(20)

export const inviteUserFormSchema = z.object({
    displayName: z.union([z.literal(''), displayNameSchema]),
    email: emailSchema,
    roleKeys: roleKeysSchema,
})

export const inviteUserInputSchema = z.object({
    displayName: displayNameSchema.optional(),
    email: emailSchema,
    roleKeys: roleKeysSchema,
})

export const updateUserFormSchema = z.object({
    displayName: displayNameSchema,
    email: emailSchema,
    roleKeys: roleKeysSchema,
})

export const updateUserInputSchema = updateUserFormSchema.extend({ userId: z.uuid() })

export const userIdInputSchema = z.object({ userId: z.uuid() })
