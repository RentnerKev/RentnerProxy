import { z } from 'zod'

import {
    ACCESS_POLICY_COMBINATIONS,
    ACCESS_POLICY_DESCRIPTION_MAX_LENGTH,
    ACCESS_POLICY_MODES,
    ACCESS_POLICY_NAME_MAX_LENGTH,
} from '../../../config/access-policies.config'

// oxlint-disable-next-line no-control-regex -- Policy names and descriptions must reject C0/C1 controls.
const ACCESS_POLICY_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u

export const accessPolicyNameSchema = z
    .string()
    .trim()
    .min(1, 'admin.accessPolicies.validation.nameRequired')
    .max(ACCESS_POLICY_NAME_MAX_LENGTH, 'admin.accessPolicies.validation.nameMax')
    .refine((value) => !ACCESS_POLICY_CONTROL_CHARACTER_PATTERN.test(value), {
        message: 'admin.accessPolicies.validation.nameInvalid',
    })

export const accessPolicyDescriptionSchema = z
    .string()
    .trim()
    .max(ACCESS_POLICY_DESCRIPTION_MAX_LENGTH, 'admin.accessPolicies.validation.descriptionMax')
    .refine((value) => !ACCESS_POLICY_CONTROL_CHARACTER_PATTERN.test(value), {
        message: 'admin.accessPolicies.validation.descriptionInvalid',
    })

export const accessPolicyModeSchema = z.enum(ACCESS_POLICY_MODES)
export const accessPolicyCombinationSchema = z.enum(ACCESS_POLICY_COMBINATIONS)

const policyFieldsSchema = z.strictObject({
    name: accessPolicyNameSchema,
    description: accessPolicyDescriptionSchema.default(''),
    mode: accessPolicyModeSchema,
    combination: accessPolicyCombinationSchema.nullable().default(null),
})

function validateCombination(
    policy: { mode: string; combination: string | null },
    context: z.RefinementCtx,
): void {
    if ((policy.mode === 'combined') !== (policy.combination !== null)) {
        context.addIssue({
            code: 'custom',
            path: ['combination'],
            message: 'admin.accessPolicies.validation.combination',
        })
    }
}

export const createAccessPolicyInputSchema = policyFieldsSchema.superRefine(validateCombination)

export const updateAccessPolicyInputSchema = z
    .strictObject({
        accessPolicyId: z.uuidv7(),
        name: accessPolicyNameSchema.optional(),
        description: accessPolicyDescriptionSchema.optional(),
        mode: accessPolicyModeSchema.optional(),
        combination: accessPolicyCombinationSchema.nullable().optional(),
    })
    .superRefine((input, context) => {
        if (
            input.name === undefined &&
            input.description === undefined &&
            input.mode === undefined &&
            input.combination === undefined
        ) {
            context.addIssue({ code: 'custom', message: 'admin.accessPolicies.validation.changes' })
        }
    })

export const accessPolicyIdInputSchema = z.strictObject({ accessPolicyId: z.uuidv7() })

export type CreateAccessPolicyInput = z.input<typeof createAccessPolicyInputSchema>
export type UpdateAccessPolicyInput = z.input<typeof updateAccessPolicyInputSchema>
