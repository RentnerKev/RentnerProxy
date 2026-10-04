import { z } from 'zod'

import {
    ACCESS_POLICY_COMBINATIONS,
    ACCESS_POLICY_DESCRIPTION_MAX_LENGTH,
    ACCESS_POLICY_MODES,
    ACCESS_POLICY_NAME_MAX_LENGTH,
} from '@/config/access-policies.config.ts'
import { accessPolicyIpRulesInputSchema } from '@/lib/AccessPolicies/ipAccessRules.ts'
import { forwardAuthInputSchema } from '@/lib/ForwardAuth/forwardAuth.ts'
import { basicAuthCredentialsInputSchema } from './basic-auth.validation.ts'

// oxlint-disable-next-line no-control-regex -- Policy names and descriptions must reject C0/C1 controls.
const ACCESS_POLICY_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u

const accessPolicyNameSchema = z
    .string()
    .trim()
    .min(1, 'admin.accessPolicies.validation.nameRequired')
    .max(ACCESS_POLICY_NAME_MAX_LENGTH, 'admin.accessPolicies.validation.nameMax')
    .refine((value) => !ACCESS_POLICY_CONTROL_CHARACTER_PATTERN.test(value), {
        message: 'admin.accessPolicies.validation.nameInvalid',
    })

const accessPolicyDescriptionSchema = z
    .string()
    .trim()
    .max(ACCESS_POLICY_DESCRIPTION_MAX_LENGTH, 'admin.accessPolicies.validation.descriptionMax')
    .refine((value) => !ACCESS_POLICY_CONTROL_CHARACTER_PATTERN.test(value), {
        message: 'admin.accessPolicies.validation.descriptionInvalid',
    })

const accessPolicyModeSchema = z.enum(ACCESS_POLICY_MODES)
const accessPolicyCombinationSchema = z.enum(ACCESS_POLICY_COMBINATIONS)

const policyFieldsSchema = z.strictObject({
    name: accessPolicyNameSchema,
    description: accessPolicyDescriptionSchema.default(''),
    mode: accessPolicyModeSchema,
    combination: accessPolicyCombinationSchema.nullable().default(null),
    ipRules: accessPolicyIpRulesInputSchema.nullable().default(null),
    forwardAuth: forwardAuthInputSchema.nullable().default(null),
    basicAuth: basicAuthCredentialsInputSchema.optional(),
})

function validateCombination(
    policy: {
        mode: string
        combination: string | null
        forwardAuth?: unknown | null
        basicAuth?: unknown
    },
    context: z.RefinementCtx,
): void {
    if ((policy.mode === 'combined') !== (policy.combination !== null)) {
        context.addIssue({
            code: 'custom',
            path: ['combination'],
            message: 'admin.accessPolicies.validation.combination',
        })
    }
    if (
        policy.forwardAuth != null &&
        (policy.mode === 'public' ||
            policy.mode === 'ip-restricted' ||
            (policy.mode === 'combined' && policy.combination !== 'all'))
    ) {
        context.addIssue({
            code: 'custom',
            path: ['forwardAuth'],
            message:
                'Forward Auth requires authenticated mode or combined mode with all providers.',
        })
    }
    validateBasicAuth(policy, context)
}

function validateBasicAuth(
    policy: { mode?: string | undefined; forwardAuth?: unknown | null; basicAuth?: unknown },
    context: z.RefinementCtx,
): void {
    if (
        policy.basicAuth !== undefined &&
        (policy.mode === 'public' || policy.mode === 'ip-restricted' || policy.forwardAuth != null)
    ) {
        context.addIssue({
            code: 'custom',
            path: ['basicAuth'],
            message:
                'Basic Auth credentials require an authentication policy without Forward Auth.',
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
        ipRules: accessPolicyIpRulesInputSchema.nullable().optional(),
        forwardAuth: forwardAuthInputSchema.nullable().optional(),
        basicAuth: basicAuthCredentialsInputSchema.optional(),
    })
    .superRefine((input, context) => {
        if (
            input.name === undefined &&
            input.description === undefined &&
            input.mode === undefined &&
            input.combination === undefined &&
            input.ipRules === undefined &&
            input.forwardAuth === undefined &&
            input.basicAuth === undefined
        ) {
            context.addIssue({ code: 'custom', message: 'admin.accessPolicies.validation.changes' })
        }
        if (
            input.forwardAuth != null &&
            (input.mode === 'public' ||
                input.mode === 'ip-restricted' ||
                input.combination === 'any')
        ) {
            context.addIssue({
                code: 'custom',
                path: ['forwardAuth'],
                message:
                    'Forward Auth requires authenticated mode or combined mode with all providers.',
            })
        }
        validateBasicAuth(input, context)
    })

export const accessPolicyIdInputSchema = z.strictObject({ accessPolicyId: z.uuidv7() })
