import { describe, expect, test } from 'bun:test'

import { ACCESS_POLICY_COMBINATIONS, ACCESS_POLICY_MODES } from '../config/access-policies.config'
import {
    createAccessPolicyInputSchema,
    updateAccessPolicyInputSchema,
} from '../features/Admin/AccessPolicyManagement/validation'

const POLICY_ID = '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6071'

describe('access policy validation', () => {
    test('accepts exactly the supported mode and combination matrix', () => {
        for (const mode of ACCESS_POLICY_MODES) {
            const combinations = mode === 'combined' ? ACCESS_POLICY_COMBINATIONS : [null]

            for (const combination of combinations) {
                const result = createAccessPolicyInputSchema.safeParse({
                    name: `Policy ${mode}`,
                    mode,
                    combination,
                })

                expect(result.success).toBe(true)
            }
        }
    })

    test('rejects non-combined policies with a combination and combined policies without one', () => {
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: 'Public with all',
                mode: 'public',
                combination: 'all',
            }).success,
        ).toBe(false)
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: 'Combined without rule',
                mode: 'combined',
                combination: null,
            }).success,
        ).toBe(false)
    })

    test('uses strict objects so provider or controller fields cannot enter the CRUD contract', () => {
        const result = createAccessPolicyInputSchema.safeParse({
            name: 'Strict policy',
            mode: 'authenticated',
            combination: null,
            provider: 'future-provider',
        })

        expect(result.success).toBe(false)
    })

    test('rejects C0, DEL, and C1 control characters in names and descriptions', () => {
        for (const control of ['\u0000', '\u007f', '\u0080', '\u009f']) {
            for (const field of ['name', 'description']) {
                expect(
                    createAccessPolicyInputSchema.safeParse({
                        name: 'Policy',
                        description: 'Description',
                        [field]: 'Before' + control + 'After',
                        mode: 'public',
                        combination: null,
                    }).success,
                ).toBe(false)
            }
        }
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: '  \u0000  ',
                mode: 'public',
                combination: null,
            }).success,
        ).toBe(false)
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: 'Policy\u007f',
                description: 'Description\u0080',
                mode: 'public',
                combination: null,
            }).success,
        ).toBe(false)
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: 'Policy',
                description: 'Description\u009f',
                mode: 'public',
                combination: null,
            }).success,
        ).toBe(false)
        expect(
            createAccessPolicyInputSchema.safeParse({
                name: '   ',
                mode: 'public',
                combination: null,
            }).success,
        ).toBe(false)
    })

    test('requires at least one update field and rejects unknown update fields', () => {
        expect(updateAccessPolicyInputSchema.safeParse({ accessPolicyId: POLICY_ID }).success).toBe(
            false,
        )
        expect(
            updateAccessPolicyInputSchema.safeParse({
                accessPolicyId: POLICY_ID,
                controller: { allow: true },
            }).success,
        ).toBe(false)
    })

    test('preserves explicit null as an update value for combination validation', () => {
        expect(
            updateAccessPolicyInputSchema.safeParse({
                accessPolicyId: POLICY_ID,
                combination: null,
            }).success,
        ).toBe(true)
    })
})
