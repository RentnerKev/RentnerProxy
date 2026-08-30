import { z } from 'zod'

import { displayNameSchema, emailSchema } from '../../Auth/Shared/validation'

export const roleKeysSchema = z
    .array(z.string().trim().min(1).max(100))
    .min(1, 'admin.users.validation.rolesRequired')
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

export const updateUserInputSchema = z.object({
    userId: z.uuid(),
    displayName: displayNameSchema,
    email: emailSchema,
    roleKeys: roleKeysSchema.optional(),
})

export const userIdInputSchema = z.object({ userId: z.uuid() })
