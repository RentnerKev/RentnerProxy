import { z } from 'zod'

export const roleKeySchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Role key must contain at least 2 characters.')
    .max(100, 'Role key must contain at most 100 characters.')
    .regex(/^[a-z][a-z0-9_.-]+$/, 'Use lowercase letters, numbers, dots, dashes, or underscores.')

export const roleNameSchema = z
    .string()
    .trim()
    .min(1, 'Enter a role name.')
    .max(100, 'Role name must contain at most 100 characters.')

export const roleDescriptionSchema = z
    .string()
    .trim()
    .max(500, 'Description must contain at most 500 characters.')

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
