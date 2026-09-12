import { z } from 'zod'

import {
    BASIC_AUTH_PASSWORD_MAX_LENGTH,
    BASIC_AUTH_USERNAME_MAX_LENGTH,
} from '../../../config/access-policies.config'

const basicAuthAccountIdSchema = z.uuidv7()
const accessPolicyIdSchema = z.uuidv7()

export const basicAuthUsernameSchema = z
    .string()
    .max(BASIC_AUTH_USERNAME_MAX_LENGTH, 'admin.accessPolicies.basicAuth.validation.username')
    .regex(
        /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/u,
        'admin.accessPolicies.basicAuth.validation.username',
    )

export const basicAuthPasswordSchema = z
    .string()
    .min(1, 'admin.accessPolicies.basicAuth.validation.password')
    .superRefine((password, context) => {
        if (password.length > BASIC_AUTH_PASSWORD_MAX_LENGTH) {
            context.addIssue({
                code: 'too_big',
                origin: 'string',
                maximum: BASIC_AUTH_PASSWORD_MAX_LENGTH,
                inclusive: true,
                message: 'admin.accessPolicies.basicAuth.validation.password',
            })
        }
    })

export const basicAuthAccountsPolicyInputSchema = z.strictObject({
    accessPolicyId: accessPolicyIdSchema,
})

export const createBasicAuthAccountInputSchema = z.strictObject({
    accessPolicyId: accessPolicyIdSchema,
    username: basicAuthUsernameSchema,
    password: basicAuthPasswordSchema,
})

export const updateBasicAuthAccountInputSchema = z
    .strictObject({
        accessPolicyId: accessPolicyIdSchema,
        accountId: basicAuthAccountIdSchema,
        username: basicAuthUsernameSchema.optional(),
        password: basicAuthPasswordSchema.optional(),
    })
    .superRefine((input, context) => {
        if (input.username === undefined && input.password === undefined) {
            context.addIssue({
                code: 'custom',
                message: 'admin.accessPolicies.basicAuth.validation.changes',
            })
        }
    })

export const deleteBasicAuthAccountInputSchema = z.strictObject({
    accessPolicyId: accessPolicyIdSchema,
    accountId: basicAuthAccountIdSchema,
})

export type BasicAuthAccountsPolicyInput = z.input<typeof basicAuthAccountsPolicyInputSchema>
export type CreateBasicAuthAccountInput = z.input<typeof createBasicAuthAccountInputSchema>
export type UpdateBasicAuthAccountInput = z.input<typeof updateBasicAuthAccountInputSchema>
export type DeleteBasicAuthAccountInput = z.input<typeof deleteBasicAuthAccountInputSchema>
