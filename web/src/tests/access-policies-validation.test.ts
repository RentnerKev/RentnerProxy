import { describe, expect, test } from 'bun:test'

import { ACCESS_POLICY_COMBINATIONS, ACCESS_POLICY_MODES } from '../config/access-policies.config'
import {
    createAccessPolicyInputSchema,
    updateAccessPolicyInputSchema,
} from '../features/Admin/AccessPolicyManagement/validation'
import { accessPolicyIpRulesInputSchema, canonicalIpNetwork } from '../shared/Helpers/ipAccessRules'

const POLICY_ID = '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6071'

describe('access policy validation', () => {
    test('accepts updates that only configure or remove IP rules', () => {
        for (const ipRules of [null, { defaultAction: 'deny', allow: ['192.0.2.1'], deny: [] }]) {
            expect(
                updateAccessPolicyInputSchema.safeParse({
                    accessPolicyId: '0198d98a-0000-7000-8000-000000000001',
                    ipRules,
                }).success,
            ).toBe(true)
        }
    })
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

    test('canonicalizes IPv4 and IPv6 hosts and networks, masks host bits, sorts, and deduplicates', () => {
        expect(canonicalIpNetwork('192.0.2.17')).toBe('192.0.2.17/32')
        expect(canonicalIpNetwork('192.0.2.17/24')).toBe('192.0.2.0/24')
        expect(canonicalIpNetwork('2001:0DB8::1')).toBe('2001:db8::1/128')
        expect(canonicalIpNetwork('2001:0DB8::1/64')).toBe('2001:db8::/64')
        expect(canonicalIpNetwork('::192.0.2.1')).toBe('::c000:201/128')
        expect(canonicalIpNetwork('2001:db8::192.0.2.1/64')).toBe('2001:db8::/64')
        expect(
            accessPolicyIpRulesInputSchema.parse({
                defaultAction: 'deny',
                allow: ['2001:0DB8::1/64', '192.0.2.17/24', '192.0.2.0/24'],
                deny: [],
            }),
        ).toEqual({
            defaultAction: 'deny',
            allow: ['192.0.2.0/24', '2001:db8::/64'],
            deny: [],
        })
    })

    test('rejects zones, mapped IPv6, malformed prefixes, and more than 128 rules per list', () => {
        for (const value of [
            'fe80::1%eth0',
            '::ffff:c000:0201',
            '::ffff:192.0.2.1',
            '192.0.2.1/-1',
            '192.0.2.1/33',
            '2001:db8::/129',
            '2001:::1',
            `${'1'.repeat(65)}/128`,
        ]) {
            expect(canonicalIpNetwork(value)).toBeNull()
        }
        expect(
            accessPolicyIpRulesInputSchema.safeParse({
                defaultAction: 'allow',
                allow: Array.from({ length: 129 }, (_, index) => `192.0.2.${index}/32`),
                deny: [],
            }).success,
        ).toBe(false)
    })
})
