import { z } from 'zod'

export const roleKeySchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'admin.roles.validation.keyMin')
    .max(100, 'admin.roles.validation.keyMax')
    .regex(/^[a-z][a-z0-9_.-]+$/, 'admin.roles.validation.keyPattern')

export const roleNameSchema = z
    .string()
    .trim()
    .min(1, 'admin.roles.validation.nameRequired')
    .max(100, 'admin.roles.validation.nameMax')

export const roleDescriptionSchema = z
    .string()
    .trim()
    .max(500, 'admin.roles.validation.descriptionMax')

export const permissionKeysSchema = z.array(z.string().trim().min(1).max(100)).max(50)

export const createRoleInputSchema = z.object({
    key: roleKeySchema,
    name: roleNameSchema,
    description: roleDescriptionSchema,
    permissionKeys: permissionKeysSchema,
})

export const updateRoleInputSchema = z.object({
    roleId: z.uuid(),
    name: roleNameSchema,
    description: roleDescriptionSchema,
    permissionKeys: permissionKeysSchema.optional(),
})

export const roleIdInputSchema = z.object({ roleId: z.uuid() })
