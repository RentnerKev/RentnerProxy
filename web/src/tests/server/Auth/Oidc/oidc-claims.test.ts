import { describe, expect, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { readVerifiedOidcClaims } from '@/server/Auth/Oidc/oidc-claims.server.ts'

const baseClaims = {
    iss: 'https://issuer.example.test',
    sub: 'stable-subject',
    exp: Math.floor(Date.now() / 1_000) + 120,
}

describe('verified OIDC claim projection', () => {
    test('projects bounded custom group claims with exact-case lookup and stable deduplication', () => {
        const identity = readVerifiedOidcClaims(
            {
                ...baseClaims,
                DepartmentGroups: ['Ops', 'ops', 'Ops'],
                departmentgroups: ['ignored-case-variant'],
            },
            'DepartmentGroups',
        )
        expect(identity.groups).toEqual(['Ops', 'ops'])
        expect(identity.expiresAt).toBe(baseClaims.exp * 1_000)

        const caseMismatch = readVerifiedOidcClaims(
            { ...baseClaims, departmentGroups: ['ignored-case-variant'] },
            'DepartmentGroups',
        )
        expect(caseMismatch.groups).toEqual([])
    })

    test('accepts missing groups as empty and enforces configured group count and length bounds', () => {
        expect(readVerifiedOidcClaims(baseClaims).groups).toEqual([])
        const maxGroups = Array.from({ length: OIDC_LIMITS.groups }, (_, index) => `group-${index}`)
        expect(readVerifiedOidcClaims({ ...baseClaims, groups: maxGroups }).groups).toHaveLength(
            OIDC_LIMITS.groups,
        )
        expect(
            readVerifiedOidcClaims({
                ...baseClaims,
                groups: ['x'.repeat(OIDC_LIMITS.groupLength)],
            }).groups,
        ).toEqual(['x'.repeat(OIDC_LIMITS.groupLength)])
    })

    test.each([
        ['null', null],
        ['a string', 'operators'],
        ['an object', { group: 'operators' }],
        ['too many groups', Array.from({ length: OIDC_LIMITS.groups + 1 }, () => 'group')],
        ['an oversized group', ['x'.repeat(OIDC_LIMITS.groupLength + 1)]],
        ['a control character', ['bad\nvalue']],
    ])('rejects %s in the configured group claim', (_label, groups) => {
        expect(() => readVerifiedOidcClaims({ ...baseClaims, groups })).toThrow(
            expect.objectContaining({ code: 'authentication_failed' }),
        )
    })

    test.each([
        [true, true],
        [false, false],
        ['true', false],
        [1, false],
        [null, false],
    ])('accepts email_verified only as boolean true (%s)', (emailVerified, expected) => {
        const identity = readVerifiedOidcClaims({
            ...baseClaims,
            email: 'person@example.test',
            email_verified: emailVerified,
        })
        expect(identity.email).toBe('person@example.test')
        expect(identity.emailVerified).toBe(expected)
    })

    test('returns no role claims, protocol tokens, or unprojected claim fields', () => {
        const identity = readVerifiedOidcClaims({
            ...baseClaims,
            groups: ['operators'],
            email: 'person@example.test',
            email_verified: true,
            name: 'Test Person',
            roles: ['owner'],
            access_token: 'secret-access-token',
            id_token: 'secret-id-token',
            refresh_token: 'secret-refresh-token',
        })
        expect(identity).toEqual({
            issuer: baseClaims.iss,
            subject: baseClaims.sub,
            expiresAt: baseClaims.exp * 1_000,
            groups: ['operators'],
            email: 'person@example.test',
            emailVerified: true,
            displayName: 'Test Person',
        })
        const projected = JSON.stringify(identity)
        for (const secret of ['secret-access-token', 'secret-id-token', 'secret-refresh-token'])
            expect(projected).not.toContain(secret)
    })

    test('requires a future expiry representable as safe epoch milliseconds', () => {
        expect(() => readVerifiedOidcClaims({ ...baseClaims, exp: 1 })).toThrow(
            expect.objectContaining({ code: 'authentication_failed' }),
        )
        expect(() =>
            readVerifiedOidcClaims({ ...baseClaims, exp: Number.MAX_SAFE_INTEGER }),
        ).toThrow(expect.objectContaining({ code: 'authentication_failed' }))
        expect(() =>
            readVerifiedOidcClaims({ ...baseClaims, exp: Number.POSITIVE_INFINITY }),
        ).toThrow(expect.objectContaining({ code: 'authentication_failed' }))
    })
})
