import { describe, expect, test } from 'bun:test'

import {
    basicAuthAccountsPolicyInputSchema,
    basicAuthPasswordSchema,
    basicAuthUsernameSchema,
    createBasicAuthAccountInputSchema,
    updateBasicAuthAccountInputSchema,
} from '../features/Admin/AccessPolicyManagement/basic-auth.validation'

const POLICY_ID = '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6071'
const ACCOUNT_ID = '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6072'

describe('Basic Auth validation', () => {
    test('accepts the case-sensitive username grammar without trimming passwords', () => {
        expect(basicAuthUsernameSchema.safeParse('Alice.Admin@example-1').success).toBe(true)
        expect(basicAuthUsernameSchema.safeParse('_starts-with-symbol').success).toBe(false)
        expect(basicAuthUsernameSchema.safeParse('contains space').success).toBe(false)
        expect(basicAuthPasswordSchema.safeParse('  pass phrase  ').success).toBe(true)
    })

    test('rejects empty or overlong passwords using application password semantics', () => {
        expect(basicAuthPasswordSchema.safeParse('').success).toBe(false)
        expect(basicAuthPasswordSchema.safeParse('a'.repeat(257)).success).toBe(false)
        expect(basicAuthPasswordSchema.safeParse('a'.repeat(256)).success).toBe(true)
    })

    test('rejects unknown fields and update requests with no changes', () => {
        expect(
            createBasicAuthAccountInputSchema.safeParse({
                accessPolicyId: POLICY_ID,
                username: 'alice',
                password: 'secret',
                passwordHash: 'caller-supplied-hash',
            }).success,
        ).toBe(false)
        expect(
            updateBasicAuthAccountInputSchema.safeParse({
                accessPolicyId: POLICY_ID,
                accountId: ACCOUNT_ID,
            }).success,
        ).toBe(false)
        expect(
            basicAuthAccountsPolicyInputSchema.safeParse({
                accessPolicyId: POLICY_ID,
                provider: 'basic-auth',
            }).success,
        ).toBe(false)
    })
})
